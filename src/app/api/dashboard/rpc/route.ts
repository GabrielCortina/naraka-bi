import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// API route que executa RPCs do dashboard com service_role.
// Resolve dois problemas:
//   1. statement_timeout=3s do role anon (causa 500 em RPCs de 2-4s)
//   2. RLS anon expondo PII em pedidos/pedido_itens (P0 da auditoria)
//
// Allowlist impede uso da rota para chamar funções arbitrárias.

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
]);

interface RpcRequestBody {
  rpc?: unknown;
  params?: unknown;
}

export const dynamic = 'force-dynamic';
export const maxDuration = 30; // segundos — Vercel hobby=10 / pro=60

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

  const params =
    body.params && typeof body.params === 'object'
      ? (body.params as Record<string, unknown>)
      : {};

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
