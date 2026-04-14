import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// API route que executa RPCs do dashboard com service_role.
// Resolve dois problemas:
//   1. statement_timeout=3s do role anon (causa 500 em RPCs de 2-4s)
//   2. RLS anon expondo PII em pedidos/pedido_itens (P0 da auditoria)
//
// Edge Runtime: latência menor (sem cold start de Node serverless).
// supabase-js v2 funciona em Edge (usa fetch nativo).

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const ALLOWED_RPCS = new Set([
  'rpc_kpis_hero',
  'rpc_kpis_hero_anterior',
  'rpc_vendas_por_dia',
  'rpc_top_skus',
  'rpc_ranking_lojas',
  'rpc_marketplace',
  'rpc_heatmap',
  'rpc_kpis_secundarios',
  'rpc_comparativo_periodos',
  'rpc_sku_detalhes',
]);

interface RpcRequestBody {
  rpc?: unknown;
  params?: unknown;
  loja?: unknown;
}

// Cache leve de loja_config no isolate (5min). Evita refetch a cada
// request quando o usuário troca de filtro mantendo a loja selecionada.
interface LojaConfigRow {
  ecommerce_nome_tiny: string;
  nome_loja: string | null;
  nome_exibicao: string | null;
}

let _lojaCfgCache: { data: LojaConfigRow[]; ts: number } | null = null;
const LOJA_CFG_TTL_MS = 5 * 60 * 1000;

async function resolveLojaServerSide(loja: string): Promise<string[]> {
  const now = Date.now();
  if (!_lojaCfgCache || now - _lojaCfgCache.ts > LOJA_CFG_TTL_MS) {
    const db = createServiceClient();
    const { data } = await db
      .from('loja_config')
      .select('ecommerce_nome_tiny, nome_loja, nome_exibicao');
    _lojaCfgCache = { data: (data as LojaConfigRow[]) ?? [], ts: now };
  }
  const matches = _lojaCfgCache.data
    .filter(
      c =>
        c.nome_loja === loja ||
        c.nome_exibicao === loja ||
        c.ecommerce_nome_tiny === loja,
    )
    .map(c => c.ecommerce_nome_tiny);
  return matches.length > 0 ? matches : [loja];
}

export async function POST(req: NextRequest) {
  let body: RpcRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const rpc = body.rpc;
  if (typeof rpc !== 'string' || !ALLOWED_RPCS.has(rpc)) {
    return NextResponse.json(
      { error: `rpc não permitida: ${String(rpc)}` },
      { status: 400 },
    );
  }

  const params: Record<string, unknown> =
    body.params && typeof body.params === 'object'
      ? { ...(body.params as Record<string, unknown>) }
      : {};

  // Resolve filtro de loja no servidor (corrige roundtrip extra do browser).
  // Se p_lojas já vier resolvido em params, respeitar (compat).
  if (params.p_lojas === undefined) {
    const loja = body.loja;
    if (typeof loja === 'string' && loja !== '') {
      params.p_lojas = await resolveLojaServerSide(loja);
    } else {
      params.p_lojas = null;
    }
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc(rpc, params);

    if (error) {
      console.error(`[api/dashboard/rpc] ${rpc} error:`, error.message);
      return NextResponse.json(
        { error: error.message, data: [] },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[api/dashboard/rpc] ${rpc} exception:`, message);
    return NextResponse.json(
      { error: message, data: [] },
      { status: 500 },
    );
  }
}
