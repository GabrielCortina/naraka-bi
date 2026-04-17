import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const TIPOS_VALIDOS = new Set([
  'preco', 'imagem_principal', 'imagens_secundarias', 'titulo', 'descricao',
  'ads', 'estoque', 'frete', 'categoria', 'variacoes', 'desativacao',
  'reativacao', 'outro',
]);

const IMPACTOS_VALIDOS = new Set(['alta', 'queda', 'neutro']);

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const p_data_inicio = parseDateParam(url.searchParams.get('data_inicio'));
  const p_data_fim    = parseDateParam(url.searchParams.get('data_fim'));
  const p_sku         = url.searchParams.get('sku') || null;
  const p_tipo        = url.searchParams.get('tipo') || null;
  const p_loja        = url.searchParams.get('loja') || null;

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc('rpc_alteracoes_listar', {
      p_data_inicio,
      p_data_fim,
      p_sku,
      p_tipo,
      p_loja,
    });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

interface PostBody {
  data_alteracao?: unknown;
  sku?: unknown;
  tipo_alteracao?: unknown;
  lojas?: unknown;
  valor_antes?: unknown;
  valor_depois?: unknown;
  motivo?: unknown;
  impacto_esperado?: unknown;
  tags?: unknown;
  observacao?: unknown;
  responsavel?: unknown;
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'invalid json' }, { status: 400 });
  }

  const data_alteracao = asTrimmedString(body.data_alteracao);
  const sku            = asTrimmedString(body.sku);
  const tipo_alteracao = asTrimmedString(body.tipo_alteracao);

  if (!data_alteracao || !/^\d{4}-\d{2}-\d{2}$/.test(data_alteracao)) {
    return NextResponse.json({ success: false, error: 'data_alteracao inválida (YYYY-MM-DD)' }, { status: 400 });
  }
  if (!sku) {
    return NextResponse.json({ success: false, error: 'sku obrigatório' }, { status: 400 });
  }
  if (!tipo_alteracao || !TIPOS_VALIDOS.has(tipo_alteracao)) {
    return NextResponse.json({ success: false, error: 'tipo_alteracao inválido' }, { status: 400 });
  }

  const impacto_raw = asTrimmedString(body.impacto_esperado);
  const impacto_esperado = impacto_raw && IMPACTOS_VALIDOS.has(impacto_raw) ? impacto_raw : null;

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map(t => t.trim())
    : null;

  // lojas: array explícito; vazio => aplica-se a todas as lojas (salvo como NULL)
  const lojasArr = Array.isArray(body.lojas)
    ? body.lojas.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map(l => l.trim())
    : [];

  const row = {
    data_alteracao,
    sku,
    tipo_alteracao,
    lojas: lojasArr.length > 0 ? lojasArr : null,
    valor_antes: asTrimmedString(body.valor_antes),
    valor_depois: asTrimmedString(body.valor_depois),
    motivo: asTrimmedString(body.motivo),
    impacto_esperado,
    tags: tags && tags.length > 0 ? tags : null,
    observacao: asTrimmedString(body.observacao),
    responsavel: asTrimmedString(body.responsavel),
  };

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('alteracoes_anuncio')
      .insert(row)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
