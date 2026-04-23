import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// API de consulta de lucro por pedido / por SKU.
// Lê lucro_pedido_stats (populada pelo cron refresh-lucro) e aplica:
//   - filtro de período (BRT)
//   - filtro de shop_id
//   - filtros funcionais (com_lucro, com_prejuizo, status)
//   - toggle de custos ativos (cmv, ads, fbs) — rateios calculados aqui
//   - tipo de margem (bruta, operacional, real)
//   - busca por texto (order_sn ou SKU)
//   - ordenação e paginação
//
// Nota: rateios de ads e FBS não são persistidos no summary porque
// dependem do período selecionado (granularidade dia vs mês).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE_DB = 1000;
const DEFAULT_LIMIT = 50;
const BR_OFFSET_MS = 3 * 3600 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Period = 'today' | 'yesterday' | '7d' | '15d' | 'month' | 'custom';
type Filtro = 'todos' | 'com_lucro' | 'com_prejuizo' | 'saudavel' | 'atencao' | 'sem_cmv';
type MargemTipo = 'bruta' | 'operacional' | 'real';
type Visao = 'pedidos' | 'skus';
type Ordem = 'lucro' | 'margem' | 'venda' | 'cmv' | 'data';
type Direcao = 'asc' | 'desc';

interface LucroRow {
  order_sn: string;
  shop_id: number;
  data_liberacao: string;
  venda: number;
  receita_liquida: number;
  comissao: number;
  taxa_servico: number;
  afiliado: number;
  cupom_seller: number;
  frete_reverso: number;
  frete_ida_seller: number;
  difal: number;
  cmv: number;
  tem_cmv: boolean;
  skus: string[];
  sku_pais: string[];
  qtd_itens: number;
  lucro_bruto: number;
  lucro_operacional: number;
  margem_bruta_pct: number;
  margem_operacional_pct: number;
  metodo_pagamento: string | null;
  status_pedido: string | null;
  tem_devolucao: boolean;
  tem_afiliado: boolean;
  cmv_pct: number;
  comissao_pct: number;
  taxa_pct: number;
  afiliado_pct: number;
  status: string;
}

interface DailyStatsRow {
  data: string;
  ads_expense: number;
  total_pedidos: number;
  gmv: number;
  fbs_wallet_debito: number;
  fbs_wallet_credito: number;
}

function brDateString(d: Date): string {
  const shifted = new Date(d.getTime() - BR_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function parsePeriod(period: Period, from: string | null, to: string | null): { from: string; to: string } {
  const today = brDateString(new Date());
  switch (period) {
    case 'today':     return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case '7d':        return { from: addDays(today, -6), to: today };
    case '15d':       return { from: addDays(today, -14), to: today };
    case 'month': {
      const [y, m] = today.split('-').map(Number);
      return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today };
    }
    case 'custom':
      if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
        throw new Error('period=custom requer from/to em YYYY-MM-DD');
      }
      if (from > to) throw new Error('from deve ser ≤ to');
      return { from, to };
  }
}

function monthRange(dateStr: string): { from: string; to: string } {
  const [y, m] = dateStr.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonth = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(nextMonth.getTime() - 86400_000);
  const last = `${lastDay.getUTCFullYear()}-${String(lastDay.getUTCMonth() + 1).padStart(2, '0')}-${String(lastDay.getUTCDate()).padStart(2, '0')}`;
  return { from: first, to: last };
}

async function fetchLucroRows(
  supabase: ReturnType<typeof createServiceClient>,
  from: string,
  to: string,
  shopFilter: number | null,
): Promise<LucroRow[]> {
  const rows: LucroRow[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('lucro_pedido_stats')
      .select('*')
      .gte('data_liberacao', from)
      .lte('data_liberacao', to)
      .range(offset, offset + PAGE_SIZE_DB - 1);
    if (shopFilter != null) q = q.eq('shop_id', shopFilter);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as LucroRow[]));
    if (data.length < PAGE_SIZE_DB) break;
    offset += PAGE_SIZE_DB;
  }
  return rows;
}

async function fetchDailyStats(
  supabase: ReturnType<typeof createServiceClient>,
  from: string,
  to: string,
  shopFilter: number | null,
): Promise<Map<string, DailyStatsRow>> {
  // Chave: `${data}|${shop_id}` agregada em 1 linha por dia (soma entre lojas
  // quando shopFilter=null) — o rateio precisa casar com o escopo da consulta.
  let q = supabase
    .from('shopee_financeiro_daily_stats')
    .select('data, shop_id, ads_expense, total_pedidos, gmv, fbs_wallet_debito, fbs_wallet_credito')
    .gte('data', from)
    .lte('data', to);
  if (shopFilter != null) q = q.eq('shop_id', shopFilter);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const map = new Map<string, DailyStatsRow>();
  for (const r of data ?? []) {
    const key = String(r.data);
    const prev = map.get(key);
    if (prev) {
      prev.ads_expense += num(r.ads_expense);
      prev.total_pedidos += num(r.total_pedidos);
      prev.gmv += num(r.gmv);
      prev.fbs_wallet_debito += num(r.fbs_wallet_debito);
      prev.fbs_wallet_credito += num(r.fbs_wallet_credito);
    } else {
      map.set(key, {
        data: key,
        ads_expense: num(r.ads_expense),
        total_pedidos: num(r.total_pedidos),
        gmv: num(r.gmv),
        fbs_wallet_debito: num(r.fbs_wallet_debito),
        fbs_wallet_credito: num(r.fbs_wallet_credito),
      });
    }
  }
  return map;
}

// Agrega shopee_financeiro_daily_stats para todo o mês de cada dia que aparece
// na consulta — base do rateio de FBS (mensal, não diário).
async function fetchMonthlyStats(
  supabase: ReturnType<typeof createServiceClient>,
  daysInQuery: Set<string>,
  shopFilter: number | null,
): Promise<Map<string, { fbs_net: number; gmv: number }>> {
  const months = new Set<string>();
  for (const d of Array.from(daysInQuery)) months.add(d.slice(0, 7));
  if (months.size === 0) return new Map();

  const result = new Map<string, { fbs_net: number; gmv: number }>();
  for (const ym of Array.from(months)) {
    const [y, m] = ym.split('-').map(Number);
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const { to } = monthRange(first);

    let q = supabase
      .from('shopee_financeiro_daily_stats')
      .select('fbs_wallet_debito, fbs_wallet_credito, gmv')
      .gte('data', first)
      .lte('data', to);
    if (shopFilter != null) q = q.eq('shop_id', shopFilter);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    let fbsNet = 0;
    let gmv = 0;
    for (const r of data ?? []) {
      fbsNet += Math.max(0, num(r.fbs_wallet_debito) - num(r.fbs_wallet_credito));
      gmv += num(r.gmv);
    }
    result.set(ym, { fbs_net: fbsNet, gmv });
  }
  return result;
}

interface ComputedRow extends LucroRow {
  rateio_ads: number;
  rateio_fbs: number;
  lucro: number;
  margem_pct: number;
}

function computeRowMetrics(
  row: LucroRow,
  custos: Set<string>,
  margemTipo: MargemTipo,
  dayStats: DailyStatsRow | undefined,
  monthFbs: { fbs_net: number; gmv: number } | undefined,
): ComputedRow {
  const ativoCmv = custos.has('cmv');
  const ativoAds = custos.has('ads');
  const ativoFbs = custos.has('fbs');

  // Rateio de ads proporcional ao GMV do dia: orderShare = venda / gmv_dia.
  // Se gmv_dia = 0, rateio = 0. Soma de rateios no dia ≈ ads_expense do dia.
  const rateioAds = ativoAds && dayStats && dayStats.gmv > 0
    ? dayStats.ads_expense * (row.venda / dayStats.gmv)
    : 0;

  // FBS é mensal (débito líquido de crédito na wallet). Rateio pelo GMV do mês.
  const rateioFbs = ativoFbs && monthFbs && monthFbs.gmv > 0
    ? monthFbs.fbs_net * (row.venda / monthFbs.gmv)
    : 0;

  const cmvAplicado = ativoCmv ? row.cmv : 0;

  // lucro "real" = receita_liquida - custos ativos
  const lucroReal = row.receita_liquida - cmvAplicado - rateioAds - rateioFbs;

  let margemPct = 0;
  if (row.venda > 0) {
    switch (margemTipo) {
      case 'bruta':
        margemPct = ((row.venda - cmvAplicado) / row.venda) * 100;
        break;
      case 'operacional':
        margemPct = ((row.receita_liquida - cmvAplicado) / row.venda) * 100;
        break;
      case 'real':
        margemPct = (lucroReal / row.venda) * 100;
        break;
    }
  }

  return { ...row, rateio_ads: rateioAds, rateio_fbs: rateioFbs, lucro: lucroReal, margem_pct: margemPct };
}

function applyFilter(rows: ComputedRow[], filtro: Filtro): ComputedRow[] {
  switch (filtro) {
    case 'todos':        return rows;
    case 'com_lucro':    return rows.filter(r => r.lucro > 0);
    case 'com_prejuizo': return rows.filter(r => r.lucro < 0);
    case 'saudavel':     return rows.filter(r => r.status === 'saudavel');
    case 'atencao':      return rows.filter(r => r.status === 'atencao');
    case 'sem_cmv':      return rows.filter(r => r.status === 'sem_cmv');
  }
}

function applySearch(rows: ComputedRow[], q: string | null): ComputedRow[] {
  if (!q) return rows;
  const needle = q.toLowerCase();
  return rows.filter(r =>
    r.order_sn.toLowerCase().includes(needle) ||
    r.skus.some(s => s.toLowerCase().includes(needle)) ||
    r.sku_pais.some(s => s.includes(needle)),
  );
}

function sortRows(rows: ComputedRow[], ordem: Ordem, direcao: Direcao): ComputedRow[] {
  const sign = direcao === 'asc' ? 1 : -1;
  const keyOf = (r: ComputedRow): number | string => {
    switch (ordem) {
      case 'lucro':  return r.lucro;
      case 'margem': return r.margem_pct;
      case 'venda':  return r.venda;
      case 'cmv':    return r.cmv;
      case 'data':   return r.data_liberacao;
    }
  };
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (typeof ka === 'string' && typeof kb === 'string') return ka.localeCompare(kb) * sign;
    return ((ka as number) - (kb as number)) * sign;
  });
}

interface Resumo {
  lucro_total: number;
  prejuizo_total: number;
  pedidos_lucrativos: number;
  pedidos_negativos: number;
  pct_lucrativos: number;
  cmv_total: number;
  margem_media: number;
  melhor_pedido: { order_sn: string; lucro: number; margem: number } | null;
  pior_pedido: { order_sn: string; lucro: number; margem: number } | null;
}

function buildResumo(rows: ComputedRow[]): Resumo {
  let lucroTotal = 0;
  let prejuizoTotal = 0;
  let pedLucr = 0;
  let pedNeg = 0;
  let cmvTotal = 0;
  let margemSoma = 0;
  let margemCount = 0;
  let melhor: ComputedRow | null = null;
  let pior: ComputedRow | null = null;

  for (const r of rows) {
    if (r.lucro > 0) { lucroTotal += r.lucro; pedLucr++; }
    else if (r.lucro < 0) { prejuizoTotal += Math.abs(r.lucro); pedNeg++; }
    cmvTotal += r.cmv;
    if (r.venda > 0) { margemSoma += r.margem_pct; margemCount++; }
    if (!melhor || r.lucro > melhor.lucro) melhor = r;
    if (!pior || r.lucro < pior.lucro) pior = r;
  }

  const total = rows.length;
  return {
    lucro_total: Math.round(lucroTotal * 100) / 100,
    prejuizo_total: Math.round(prejuizoTotal * 100) / 100,
    pedidos_lucrativos: pedLucr,
    pedidos_negativos: pedNeg,
    pct_lucrativos: total > 0 ? Math.round((pedLucr / total) * 1000) / 10 : 0,
    cmv_total: Math.round(cmvTotal * 100) / 100,
    margem_media: margemCount > 0 ? Math.round((margemSoma / margemCount) * 100) / 100 : 0,
    melhor_pedido: melhor ? { order_sn: melhor.order_sn, lucro: Math.round(melhor.lucro * 100) / 100, margem: Math.round(melhor.margem_pct * 100) / 100 } : null,
    pior_pedido:   pior   ? { order_sn: pior.order_sn,   lucro: Math.round(pior.lucro * 100) / 100,   margem: Math.round(pior.margem_pct * 100) / 100 }   : null,
  };
}

function serializePedido(r: ComputedRow) {
  return {
    order_sn: r.order_sn,
    data: r.data_liberacao,
    skus: r.skus,
    sku_pais: r.sku_pais,
    qtd_itens: r.qtd_itens,
    venda: r.venda,
    cmv: r.cmv,
    comissao: r.comissao,
    taxa_servico: r.taxa_servico,
    afiliado: r.afiliado,
    cupom_seller: r.cupom_seller,
    frete_devolucao: r.frete_reverso + r.frete_ida_seller,
    difal: r.difal,
    rateio_ads: Math.round(r.rateio_ads * 100) / 100,
    rateio_fbs: Math.round(r.rateio_fbs * 100) / 100,
    receita_liquida: r.receita_liquida,
    lucro: Math.round(r.lucro * 100) / 100,
    margem_pct: Math.round(r.margem_pct * 100) / 100,
    status: r.status,
    tem_cmv: r.tem_cmv,
    metodo_pagamento: r.metodo_pagamento,
    tem_devolucao: r.tem_devolucao,
    tem_afiliado: r.tem_afiliado,
    breakdown: {
      cmv_pct: r.cmv_pct,
      comissao_pct: r.comissao_pct,
      taxa_pct: r.taxa_pct,
      afiliado_pct: r.afiliado_pct,
      lucro_pct: r.margem_pct,
    },
  };
}

interface SkuAggregate {
  sku_pai: string;
  qtd_vendida: number;
  venda_total: number;
  cmv_total: number;
  lucro_total: number;
  margem_soma: number;
  margem_count: number;
  pedidos_count: number;
  pedidos_negativos: number;
  tem_cmv_any: boolean;
  status_any: Set<string>;
}

function aggregateBySku(rows: ComputedRow[]): SkuAggregate[] {
  // Um pedido pode ter múltiplos sku_pais: rateia venda/cmv/lucro
  // proporcionalmente à quantidade de sku_pais do pedido (fallback simples).
  // Queries que precisam de rateio por valor do item devem iterar em pedido_itens.
  const map = new Map<string, SkuAggregate>();
  for (const r of rows) {
    if (r.sku_pais.length === 0) continue;
    const share = 1 / r.sku_pais.length;
    for (const pai of r.sku_pais) {
      let agg = map.get(pai);
      if (!agg) {
        agg = {
          sku_pai: pai,
          qtd_vendida: 0,
          venda_total: 0,
          cmv_total: 0,
          lucro_total: 0,
          margem_soma: 0,
          margem_count: 0,
          pedidos_count: 0,
          pedidos_negativos: 0,
          tem_cmv_any: false,
          status_any: new Set<string>(),
        };
        map.set(pai, agg);
      }
      agg.qtd_vendida += r.qtd_itens * share;
      agg.venda_total += r.venda * share;
      agg.cmv_total += r.cmv * share;
      agg.lucro_total += r.lucro * share;
      if (r.venda > 0) {
        agg.margem_soma += r.margem_pct;
        agg.margem_count += 1;
      }
      agg.pedidos_count += 1;
      if (r.lucro < 0) agg.pedidos_negativos += 1;
      if (r.tem_cmv) agg.tem_cmv_any = true;
      agg.status_any.add(r.status);
    }
  }
  return Array.from(map.values());
}

function serializeSku(agg: SkuAggregate) {
  // Status resultante: prejuizo se qualquer lucro negativo domina; sem_cmv se
  // nenhum pedido tinha CMV; senão usa o "pior" entre atencao/saudavel.
  let status = 'saudavel';
  if (!agg.tem_cmv_any) status = 'sem_cmv';
  else if (agg.pedidos_negativos > 0) status = 'atencao';
  if (agg.pedidos_count > 0 && agg.pedidos_negativos === agg.pedidos_count) status = 'prejuizo';

  return {
    sku_pai: agg.sku_pai,
    descricao: `SKU ${agg.sku_pai}`,
    qtd_vendida: Math.round(agg.qtd_vendida),
    venda_total: Math.round(agg.venda_total * 100) / 100,
    cmv_total: Math.round(agg.cmv_total * 100) / 100,
    lucro_total: Math.round(agg.lucro_total * 100) / 100,
    margem_media: agg.margem_count > 0 ? Math.round((agg.margem_soma / agg.margem_count) * 100) / 100 : 0,
    pedidos_negativos: agg.pedidos_negativos,
    pct_negativos: agg.pedidos_count > 0 ? Math.round((agg.pedidos_negativos / agg.pedidos_count) * 1000) / 10 : 0,
    tem_cmv: agg.tem_cmv_any,
    status,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const period = (searchParams.get('period') ?? '7d') as Period;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const shopParam = searchParams.get('shop_id') ?? 'all';
  const filtro = (searchParams.get('filtro') ?? 'todos') as Filtro;
  const custosParam = (searchParams.get('custos') ?? 'cmv').split(',').map(s => s.trim()).filter(Boolean);
  const custos = new Set(custosParam);
  const margemTipo = (searchParams.get('margem') ?? 'operacional') as MargemTipo;
  const visao = (searchParams.get('visao') ?? 'pedidos') as Visao;
  const busca = searchParams.get('busca');
  const ordem = (searchParams.get('ordem') ?? 'lucro') as Ordem;
  const direcao = (searchParams.get('direcao') ?? 'desc') as Direcao;
  const page = Math.max(1, Number(searchParams.get('page') ?? 1));
  const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit') ?? DEFAULT_LIMIT)));

  let range: { from: string; to: string };
  try {
    range = parsePeriod(period, fromParam, toParam);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'período inválido' }, { status: 400 });
  }

  const shopFilter = shopParam === 'all' ? null : Number(shopParam);
  if (shopFilter !== null && !Number.isFinite(shopFilter)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    const rawRows = await fetchLucroRows(supabase, range.from, range.to, shopFilter);
    const dayStats = custos.has('ads') || custos.has('fbs')
      ? await fetchDailyStats(supabase, range.from, range.to, shopFilter)
      : new Map<string, DailyStatsRow>();
    const monthlyStats = custos.has('fbs')
      ? await fetchMonthlyStats(supabase, new Set(rawRows.map(r => r.data_liberacao)), shopFilter)
      : new Map<string, { fbs_net: number; gmv: number }>();

    const computed: ComputedRow[] = rawRows.map(r =>
      computeRowMetrics(
        r,
        custos,
        margemTipo,
        dayStats.get(r.data_liberacao),
        monthlyStats.get(r.data_liberacao.slice(0, 7)),
      ),
    );

    const filtered = applySearch(applyFilter(computed, filtro), busca);
    const resumo = buildResumo(filtered);

    if (visao === 'skus') {
      const aggregated = aggregateBySku(filtered);
      aggregated.sort((a, b) => (b.lucro_total - a.lucro_total));
      const total = aggregated.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const start = (page - 1) * limit;
      const paged = aggregated.slice(start, start + limit).map(serializeSku);

      return NextResponse.json({
        resumo,
        skus: paged,
        pagination: { page, limit, total, total_pages: totalPages },
      });
    }

    // Visão pedidos
    const sorted = sortRows(filtered, ordem, direcao);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const paged = sorted.slice(start, start + limit).map(serializePedido);

    return NextResponse.json({
      resumo,
      pedidos: paged,
      pagination: { page, limit, total, total_pages: totalPages },
    });
  } catch (err) {
    console.error('[api/lucro] erro:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'erro interno' },
      { status: 500 },
    );
  }
}
