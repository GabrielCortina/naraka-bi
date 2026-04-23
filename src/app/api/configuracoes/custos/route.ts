import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// CRUD de custos de mercadoria (sku_custo). Usado pela seção "Custos"
// em configurações. Lista todos os SKUs com vendas nos últimos 30 dias
// (dashboard_sku_daily_stats) e marca cada um com um status baseado em
// quais faixas já têm custo cadastrado.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LOOKBACK_DAYS = 30;
const PAGE_SIZE = 1000;

interface CustoRow {
  id: number;
  sku_pai: string;
  faixa: string;
  tamanhos: string[];
  custo_unitario: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  observacao: string | null;
}

type SkuStatus = 'sem' | 'parcial' | 'completo';

interface SkuVendaRow {
  sku_pai: string;
  qtd_vendida_30d: number;
  faturamento_30d: number;
  status: SkuStatus;
  faixas_cadastradas: string[];
}

// Regras de status:
// - completo: tem faixa "unico" (cobre todos os tamanhos) OU tem ambos "regular" e "plus".
// - parcial:  tem ao menos uma faixa cadastrada mas não cobre tudo (ex: só regular).
// - sem:      nenhum registro em sku_custo.
function computeStatus(faixas: Set<string>): SkuStatus {
  if (faixas.size === 0) return 'sem';
  if (faixas.has('unico')) return 'completo';
  if (faixas.has('regular') && faixas.has('plus')) return 'completo';
  return 'parcial';
}

function extractSkuPai(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const m = sku.match(/^(\d+)/);
  return m ? m[1] : null;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Dispara recálculo do summary lucro_pedido_stats para todas as combinações
// (shop_id, data_liberacao) onde este sku_pai aparece nos últimos 30 dias.
// Best-effort: falhas são logadas mas não propagam — o cron refresh-lucro
// (*/10 min) recalcula de qualquer forma na próxima rodada.
async function recalcLucroForSkuPai(
  supabase: ReturnType<typeof createServiceClient>,
  sku_pai: string,
): Promise<{ attempted: number; failed: number }> {
  const RECALC_WINDOW_DAYS = 30;
  const MAX_PAIRS = 60; // teto defensivo para não estourar timeout do handler

  const today = todayDateStr();
  const from = addDaysStr(today, -RECALC_WINDOW_DAYS + 1);

  const { data, error } = await supabase
    .from('lucro_pedido_stats')
    .select('shop_id, data_liberacao')
    .contains('sku_pais', [sku_pai])
    .gte('data_liberacao', from)
    .lte('data_liberacao', today);

  if (error) {
    console.error('[configuracoes/custos] recalc lookup falhou:', error.message);
    return { attempted: 0, failed: 0 };
  }

  // Pares únicos (shop_id, data) — uma loja pode ter vários pedidos no mesmo dia.
  const seen = new Set<string>();
  const pairs: Array<{ shop_id: number; data: string }> = [];
  for (const r of data ?? []) {
    const key = `${r.shop_id}|${r.data_liberacao}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ shop_id: Number(r.shop_id), data: String(r.data_liberacao) });
    if (pairs.length >= MAX_PAIRS) break;
  }

  if (pairs.length === 0) return { attempted: 0, failed: 0 };

  const results = await Promise.allSettled(
    pairs.map(p =>
      supabase.rpc('refresh_lucro_pedido_stats', { p_data: p.data, p_shop_id: p.shop_id }),
    ),
  );

  let failed = 0;
  for (const r of results) {
    if (r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)) failed++;
  }
  if (failed > 0) {
    console.warn(
      `[configuracoes/custos] recalc sku_pai=${sku_pai} falhou em ${failed}/${pairs.length} pares — cron vai compensar`,
    );
  }
  return { attempted: pairs.length, failed };
}

export async function GET() {
  const supabase = createServiceClient();

  const { data: custosData, error: custosErr } = await supabase
    .from('sku_custo')
    .select('id, sku_pai, faixa, tamanhos, custo_unitario, vigencia_inicio, vigencia_fim, observacao')
    .order('sku_pai', { ascending: true })
    .order('faixa', { ascending: true })
    .order('vigencia_inicio', { ascending: false });

  if (custosErr) {
    return NextResponse.json({ error: custosErr.message }, { status: 500 });
  }

  const custos = (custosData ?? []) as CustoRow[];

  // Mapa de sku_pai → conjunto de faixas cadastradas (para derivar status).
  const faixasPorPai = new Map<string, Set<string>>();
  for (const c of custos) {
    let set = faixasPorPai.get(c.sku_pai);
    if (!set) { set = new Set<string>(); faixasPorPai.set(c.sku_pai, set); }
    set.add(c.faixa);
  }

  // SKU pais com vendas nos últimos 30 dias (agregado do summary do dashboard).
  // Pagina o SELECT porque o default do supabase-js é 1000 linhas — com N SKUs ×
  // M lojas × 30 dias a granular passa fácil desse teto, truncando a lista.
  const today = todayDateStr();
  const from = addDaysStr(today, -LOOKBACK_DAYS + 1);

  const agg = new Map<string, { qtd: number; fat: number }>();
  let offset = 0;
  while (true) {
    const { data: page, error: statsErr } = await supabase
      .from('dashboard_sku_daily_stats')
      .select('sku_pai, sku, faturamento, quantidade')
      .gte('data_pedido', from)
      .lte('data_pedido', today)
      .range(offset, offset + PAGE_SIZE - 1);

    if (statsErr) {
      return NextResponse.json({ error: statsErr.message }, { status: 500 });
    }
    if (!page || page.length === 0) break;

    // Agrega por sku_pai — a tabela já tem sku_pai materializado, mas
    // re-extraímos por sku caso o stats antigo tenha vindo vazio/NULL.
    for (const row of page) {
      const pai = (row.sku_pai as string | null) ?? extractSkuPai(row.sku as string);
      if (!pai) continue;
      const e = agg.get(pai) ?? { qtd: 0, fat: 0 };
      e.qtd += Number(row.quantidade ?? 0);
      e.fat += Number(row.faturamento ?? 0);
      agg.set(pai, e);
    }

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Lista todos os SKUs com vendas recentes — o filtro anterior removia
  // completamente o card quando qualquer faixa era cadastrada, o que impedia
  // adicionar a faixa complementar (ex: cadastrei "regular" e sumiu, impossível
  // adicionar "plus" pelo card). Agora cada linha vem marcada com status.
  const skus_com_vendas: SkuVendaRow[] = Array.from(agg.entries())
    .map(([pai, v]) => {
      const faixas = faixasPorPai.get(pai) ?? new Set<string>();
      return {
        sku_pai: pai,
        qtd_vendida_30d: Math.round(v.qtd),
        faturamento_30d: Math.round(v.fat * 100) / 100,
        status: computeStatus(faixas),
        faixas_cadastradas: Array.from(faixas).sort(),
      };
    })
    .sort((a, b) => {
      // Ordem: sem > parcial > completo; dentro do grupo, por faturamento desc.
      const rank: Record<SkuStatus, number> = { sem: 0, parcial: 1, completo: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return b.faturamento_30d - a.faturamento_30d;
    });

  return NextResponse.json({ custos, skus_com_vendas });
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient();

  let body: {
    id?: number;
    sku_pai?: string;
    faixa?: string;
    tamanhos?: string[];
    custo_unitario?: number;
    vigencia_inicio?: string;
    observacao?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sku_pai = (body.sku_pai ?? '').trim();
  const faixa = (body.faixa ?? 'unico').trim();
  const tamanhos = Array.isArray(body.tamanhos) ? body.tamanhos : [];
  const custo_unitario = Number(body.custo_unitario);
  const vigencia_inicio = (body.vigencia_inicio ?? todayDateStr()).trim();
  const observacao = body.observacao?.toString().trim() || null;

  if (!sku_pai) {
    return NextResponse.json({ error: 'sku_pai obrigatório' }, { status: 400 });
  }
  if (!['regular', 'plus', 'unico'].includes(faixa)) {
    return NextResponse.json({ error: "faixa deve ser 'regular', 'plus' ou 'unico'" }, { status: 400 });
  }
  if (!Number.isFinite(custo_unitario) || custo_unitario <= 0) {
    return NextResponse.json({ error: 'custo_unitario deve ser > 0' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia_inicio)) {
    return NextResponse.json({ error: 'vigencia_inicio deve ser YYYY-MM-DD' }, { status: 400 });
  }

  const tamanhosFinal = faixa === 'unico' ? [] : tamanhos;

  // Se veio id, é edição direta — UPDATE puro, sem mexer em vigência.
  if (body.id != null) {
    const { data, error } = await supabase
      .from('sku_custo')
      .update({
        sku_pai,
        faixa,
        tamanhos: tamanhosFinal,
        custo_unitario,
        vigencia_inicio,
        observacao,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await recalcLucroForSkuPai(supabase, sku_pai);
    return NextResponse.json({ success: true, data });
  }

  // Se já existe um registro (sku_pai, faixa, vigencia_inicio) → UPDATE.
  const { data: existing } = await supabase
    .from('sku_custo')
    .select('id')
    .eq('sku_pai', sku_pai)
    .eq('faixa', faixa)
    .eq('vigencia_inicio', vigencia_inicio)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from('sku_custo')
      .update({
        tamanhos: tamanhosFinal,
        custo_unitario,
        observacao,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id as number)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await recalcLucroForSkuPai(supabase, sku_pai);
    return NextResponse.json({ success: true, data });
  }

  // Novo cadastro: fecha o vigente (vigencia_fim IS NULL com mesma
  // (sku_pai, faixa)) com vigencia_fim = vigencia_inicio do novo - 1d,
  // desde que o vigente seja anterior. Caso contrário, mantém — a
  // constraint chk_vigencia vai reclamar se sobrepor.
  const { data: vigenteList } = await supabase
    .from('sku_custo')
    .select('id, vigencia_inicio')
    .eq('sku_pai', sku_pai)
    .eq('faixa', faixa)
    .is('vigencia_fim', null);

  for (const v of vigenteList ?? []) {
    const vInicio = v.vigencia_inicio as string;
    if (vInicio < vigencia_inicio) {
      const novoFim = addDaysStr(vigencia_inicio, -1);
      await supabase
        .from('sku_custo')
        .update({ vigencia_fim: novoFim, updated_at: new Date().toISOString() })
        .eq('id', v.id as number);
    }
  }

  const { data, error } = await supabase
    .from('sku_custo')
    .insert({
      sku_pai,
      faixa,
      tamanhos: tamanhosFinal,
      custo_unitario,
      vigencia_inicio,
      observacao,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await recalcLucroForSkuPai(supabase, sku_pai);
  return NextResponse.json({ success: true, data });
}

export async function DELETE(request: NextRequest) {
  const supabase = createServiceClient();

  let body: { id?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  }

  // Lê o sku_pai antes de deletar — precisamos dele para disparar o recálculo
  // dos pedidos afetados depois que a linha já não existe.
  const { data: existing } = await supabase
    .from('sku_custo')
    .select('sku_pai')
    .eq('id', id)
    .maybeSingle();

  const { error } = await supabase.from('sku_custo').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (existing?.sku_pai) {
    await recalcLucroForSkuPai(supabase, existing.sku_pai as string);
  }

  return NextResponse.json({ success: true, deleted: id });
}
