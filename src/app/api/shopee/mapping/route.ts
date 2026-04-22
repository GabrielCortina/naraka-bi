import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// CRUD de shopee_transaction_mapping + levantamento de tipos ainda
// não classificados vistos na wallet nos últimos 30 dias.
// A lista não-mapeada dispara a UI de "novo tipo detectado" em
// /configuracoes/shopee — sem isso, um novo tipo caía silenciosamente
// em "outros custos" até alguém abrir o banco e classificar à mão.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CLASSIFICACOES = new Set([
  'receita',
  'custo_plataforma',
  'custo_aquisicao',
  'custo_friccao',
  'informativo',
  'ignorar',
]);

const KPIS = new Set([
  'receita_escrow',
  'comissao',
  'taxa',
  'ads',
  'afiliados',
  'difal',
  'devolucao',
  'devolucao_frete',
  'saque',
  'pedidos_negativos',
  'fbs',
  'compensacao',
  'outros',
  'ignorar',
]);

const NATUREZAS = new Set(['credito', 'debito', 'neutro']);

const PAGE_SIZE = 1000;

interface MappingRow {
  transaction_type: string;
  classificacao: string;
  kpi_destino: string;
  descricao_pt: string;
  entra_no_custo_total: boolean;
  duplica_com: string | null;
  natureza: string;
  updated_at: string | null;
}

interface WalletRow {
  transaction_type: string | null;
  amount: number | null;
  description: string | null;
  money_flow: string | null;
}

interface UnmappedAggr {
  transaction_type: string;
  count: number;
  total: number;
  money_flow: string | null;
  exemplo_descricao: string | null;
}

export async function GET() {
  try {
    const supabase = createServiceClient();

    const { data: mapeadosRaw, error: errMap } = await supabase
      .from('shopee_transaction_mapping')
      .select(
        'transaction_type, classificacao, kpi_destino, descricao_pt, entra_no_custo_total, duplica_com, natureza, updated_at',
      )
      .order('updated_at', { ascending: false });

    if (errMap) {
      return NextResponse.json({ error: errMap.message }, { status: 500 });
    }

    const mapeados = (mapeadosRaw as MappingRow[] | null) ?? [];
    const mappedSet = new Set(mapeados.map(m => m.transaction_type));

    // Wallet dos últimos 30 dias. PostgREST retorna no máximo 1000 linhas
    // por página — paginação manual para cobrir lojas com alto volume.
    const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString();
    const walletRows: WalletRow[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('shopee_wallet')
        .select('transaction_type, amount, description, money_flow')
        .gte('create_time', sinceIso)
        .neq('transaction_type', '')
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      const page = (data as WalletRow[] | null) ?? [];
      if (page.length === 0) break;
      walletRows.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    const aggr = new Map<string, UnmappedAggr>();
    for (const w of walletRows) {
      const tt = (w.transaction_type ?? '').trim();
      if (!tt || mappedSet.has(tt)) continue;
      const existing = aggr.get(tt) ?? {
        transaction_type: tt,
        count: 0,
        total: 0,
        money_flow: w.money_flow,
        exemplo_descricao: null,
      };
      existing.count++;
      existing.total += Number(w.amount ?? 0);
      if (!existing.exemplo_descricao && w.description) {
        existing.exemplo_descricao = w.description;
      }
      // Preenche money_flow se a primeira linha estava null.
      if (!existing.money_flow && w.money_flow) {
        existing.money_flow = w.money_flow;
      }
      aggr.set(tt, existing);
    }

    const nao_mapeados = Array.from(aggr.values())
      .map(a => ({ ...a, total: Math.round(a.total * 100) / 100 }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ mapeados, nao_mapeados });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

interface PostBody {
  transaction_type?: unknown;
  classificacao?: unknown;
  kpi_destino?: unknown;
  descricao_pt?: unknown;
  entra_no_custo_total?: unknown;
  duplica_com?: unknown;
  natureza?: unknown;
}

function validatePostBody(body: PostBody): { ok: true; row: Omit<MappingRow, 'updated_at'> } | { ok: false; error: string } {
  const tt = typeof body.transaction_type === 'string' ? body.transaction_type.trim() : '';
  if (!tt) return { ok: false, error: 'transaction_type é obrigatório' };
  if (tt.length > 128) return { ok: false, error: 'transaction_type muito longo' };

  const classificacao = typeof body.classificacao === 'string' ? body.classificacao : '';
  if (!CLASSIFICACOES.has(classificacao)) {
    return { ok: false, error: `classificacao inválida: ${classificacao}` };
  }

  const kpi_destino = typeof body.kpi_destino === 'string' ? body.kpi_destino : '';
  if (!KPIS.has(kpi_destino)) {
    return { ok: false, error: `kpi_destino inválido: ${kpi_destino}` };
  }

  const descricao_pt = typeof body.descricao_pt === 'string' ? body.descricao_pt.trim() : '';
  if (!descricao_pt) return { ok: false, error: 'descricao_pt é obrigatória' };

  const entra_no_custo_total = body.entra_no_custo_total === true;

  let duplica_com: string | null = null;
  if (typeof body.duplica_com === 'string') {
    const t = body.duplica_com.trim();
    duplica_com = t.length > 0 ? t : null;
  }

  const natureza = typeof body.natureza === 'string' ? body.natureza : '';
  if (!NATUREZAS.has(natureza)) {
    return { ok: false, error: `natureza inválida: ${natureza}` };
  }

  return {
    ok: true,
    row: {
      transaction_type: tt,
      classificacao,
      kpi_destino,
      descricao_pt,
      entra_no_custo_total,
      duplica_com,
      natureza,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PostBody;
    const parsed = validatePostBody(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('shopee_transaction_mapping')
      .upsert(
        { ...parsed.row, updated_at: new Date().toISOString() },
        { onConflict: 'transaction_type' },
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { transaction_type?: unknown };
    const tt = typeof body.transaction_type === 'string' ? body.transaction_type.trim() : '';
    if (!tt) {
      return NextResponse.json({ error: 'transaction_type é obrigatório' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from('shopee_transaction_mapping')
      .delete()
      .eq('transaction_type', tt);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: tt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
