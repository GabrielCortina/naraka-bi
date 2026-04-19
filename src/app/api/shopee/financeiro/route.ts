import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';

// Dashboard financeiro Shopee. Agrega KPIs, séries temporais e conciliação
// em uma única chamada. Todo cálculo no backend para a UI só renderizar.
//
// Query params:
//   ?period=today|yesterday|7d|15d|month|last_month|custom
//   ?from=YYYY-MM-DD & to=YYYY-MM-DD   (obrigatórios quando period=custom)
//   ?shop_id=all|<id>
//
// Referência de cálculos: ver regras 1–12 na spec da fase 3.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const DAY_MS = 86400000;

type PeriodKey = 'today' | 'yesterday' | '7d' | '15d' | 'month' | 'last_month' | 'custom';

const PERIOD_LABELS: Record<string, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': '7 dias',
  '15d': '15 dias',
  month: 'Mês atual',
  last_month: 'Mês anterior',
  custom: 'Personalizado',
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function computePeriod(
  period: PeriodKey,
  fromStr: string | null,
  toStr: string | null,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  let from: Date;
  let to: Date;

  switch (period) {
    case 'today':
      from = startOfDay(now); to = endOfDay(now); break;
    case 'yesterday': {
      const y = new Date(now.getTime() - DAY_MS);
      from = startOfDay(y); to = endOfDay(y); break;
    }
    case '7d':
      to = endOfDay(now); from = startOfDay(new Date(now.getTime() - 6 * DAY_MS)); break;
    case '15d':
      to = endOfDay(now); from = startOfDay(new Date(now.getTime() - 14 * DAY_MS)); break;
    case 'month':
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); to = endOfDay(now); break;
    case 'last_month': {
      const firstThis = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastPrev = new Date(firstThis.getTime() - DAY_MS);
      from = startOfDay(new Date(lastPrev.getFullYear(), lastPrev.getMonth(), 1));
      to = endOfDay(lastPrev);
      break;
    }
    case 'custom':
      if (!fromStr || !toStr) throw new Error('period=custom requer from e to');
      from = startOfDay(new Date(`${fromStr}T00:00:00`));
      to = endOfDay(new Date(`${toStr}T00:00:00`));
      if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) {
        throw new Error('from/to inválidos');
      }
      break;
    default:
      to = endOfDay(now); from = startOfDay(new Date(now.getTime() - 6 * DAY_MS));
  }

  return { from, to, label: PERIOD_LABELS[period] ?? '—' };
}

// Tipos da wallet já tratados em outras categorias — NÃO entram em "outros".
const HANDLED_TYPES = new Set([
  'ESCROW_VERIFIED_ADD',
  'ESCROW_VERIFIED_MINUS',
  'SPM_DEDUCT',
  'PAID_ADS',
  'PAID_ADS_REFUND',
  'AFFILIATE_ADS_SELLER_FEE',
  'AFFILIATE_ADS_SELLER_FEE_REFUND',
  'AFFILIATE_FEE_DEDUCT',
  'WITHDRAWAL_CREATED',
  'WITHDRAWAL_COMPLETED',
  'WITHDRAWAL_CANCELLED',
  'ADJUSTMENT_FOR_RR_AFTER_ESCROW_VERIFIED',
]);

function categorize(tt: string, desc: string): string {
  const d = desc.toLowerCase();
  if (tt.startsWith('FBS_')) return 'custos_fbs';
  if (tt === 'FSF_COST_PASSING_DEDUCT') return 'custos_fsf';
  if (tt.startsWith('PERCEPTION_') || tt.includes('TAX')) return 'custos_impostos';
  if (d.includes('difal') || d.includes('imposto') || d.includes('tax')) return 'custos_impostos';
  if (
    d.includes('parcel was lost') ||
    d.includes('item perdido') ||
    d.includes('compensation') ||
    d.includes('compensação')
  ) return 'compensacao';
  if (tt === 'ADJUSTMENT_ADD') return 'compensacao';
  if (tt === 'ADJUSTMENT_MINUS') return 'custos_ajuste';
  return 'outros';
}

interface EscrowAggr {
  count: number;
  buyer_total: number;
  escrow_amount: number;
  commission_fee: number;
  service_fee: number;
  shopee_discount: number;
  voucher_from_shopee: number;
  coins: number;
  credit_card_promotion: number;
  pix_discount: number;
  seller_return_refund: number;
}
function emptyEscrow(): EscrowAggr {
  return {
    count: 0, buyer_total: 0, escrow_amount: 0, commission_fee: 0, service_fee: 0,
    shopee_discount: 0, voucher_from_shopee: 0, coins: 0, credit_card_promotion: 0,
    pix_discount: 0, seller_return_refund: 0,
  };
}

interface OutrosGroup {
  transaction_type: string;
  description: string;
  count: number;
  total: number;
  categoria: string;
}
interface WalletAggr {
  afiliados: number;
  afiliados_refund: number;
  devolucoes: number;
  devolucoes_qtd: number;
  saques: number;
  outros_map: Map<string, OutrosGroup>;
}
function emptyWallet(): WalletAggr {
  return {
    afiliados: 0, afiliados_refund: 0, devolucoes: 0, devolucoes_qtd: 0,
    saques: 0, outros_map: new Map<string, OutrosGroup>(),
  };
}

interface AdsAggr {
  expense: number;
  broad_gmv: number;
  by_date: Map<string, number>;
}
function emptyAds(): AdsAggr {
  return { expense: 0, broad_gmv: 0, by_date: new Map<string, number>() };
}

interface PeriodData {
  escrow: EscrowAggr;
  wallet: WalletAggr;
  ads: AdsAggr;
  pedidos_by_day: Map<string, { bruto: number; liquido: number }>;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchPeriod(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  shopIds: number[],
): Promise<PeriodData> {
  // 1. Pedidos no período (order_sn + create_time) — backbone dos joins.
  const pedidosQ = supabase
    .from('shopee_pedidos')
    .select('order_sn, create_time')
    .gte('create_time', fromIso)
    .lte('create_time', toIso)
    .in('shop_id', shopIds)
    .range(0, 49999);
  const { data: pedidos } = await pedidosQ;

  const snToDate = new Map<string, string>();
  const sns: string[] = [];
  for (const p of pedidos ?? []) {
    const sn = p.order_sn as string;
    const ct = p.create_time as string | null;
    if (!sn) continue;
    sns.push(sn);
    if (ct) snToDate.set(sn, ct.substring(0, 10));
  }

  const escrow = emptyEscrow();
  const pedidosByDay = new Map<string, { bruto: number; liquido: number }>();

  // 2. Escrow para os SNs do período — em chunks para não estourar tamanho da IN-clause.
  if (sns.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < sns.length; i += CHUNK) {
      const chunk = sns.slice(i, i + CHUNK);
      const { data: rows } = await supabase
        .from('shopee_escrow')
        .select(
          'order_sn, buyer_total_amount, escrow_amount, commission_fee, service_fee, shopee_discount, voucher_from_shopee, coins, credit_card_promotion, pix_discount, seller_return_refund',
        )
        .in('shop_id', shopIds)
        .in('order_sn', chunk)
        .range(0, 9999);

      for (const r of rows ?? []) {
        escrow.count++;
        const b = num(r.buyer_total_amount);
        const a = num(r.escrow_amount);
        escrow.buyer_total += b;
        escrow.escrow_amount += a;
        escrow.commission_fee += num(r.commission_fee);
        escrow.service_fee += num(r.service_fee);
        escrow.shopee_discount += num(r.shopee_discount);
        escrow.voucher_from_shopee += num(r.voucher_from_shopee);
        escrow.coins += num(r.coins);
        escrow.credit_card_promotion += num(r.credit_card_promotion);
        escrow.pix_discount += num(r.pix_discount);
        escrow.seller_return_refund += num(r.seller_return_refund);

        const date = snToDate.get(r.order_sn as string);
        if (date) {
          const e = pedidosByDay.get(date) ?? { bruto: 0, liquido: 0 };
          e.bruto += b;
          e.liquido += a;
          pedidosByDay.set(date, e);
        }
      }
    }
  }

  // 3. Wallet no período (filtra por create_time).
  const { data: walletRows } = await supabase
    .from('shopee_wallet')
    .select('transaction_type, amount, description, money_flow')
    .gte('create_time', fromIso)
    .lte('create_time', toIso)
    .in('shop_id', shopIds)
    .range(0, 49999);

  const wallet = emptyWallet();
  for (const w of walletRows ?? []) {
    const tt = (w.transaction_type as string) ?? '';
    const amount = num(w.amount);
    const desc = ((w.description as string | null) ?? '').trim();

    if (tt === 'AFFILIATE_ADS_SELLER_FEE' || tt === 'AFFILIATE_FEE_DEDUCT') {
      wallet.afiliados += Math.abs(amount);
    } else if (tt === 'AFFILIATE_ADS_SELLER_FEE_REFUND') {
      wallet.afiliados_refund += Math.abs(amount);
    } else if (tt === 'ADJUSTMENT_FOR_RR_AFTER_ESCROW_VERIFIED') {
      wallet.devolucoes += Math.abs(amount);
      wallet.devolucoes_qtd++;
    } else if (
      (tt === 'WITHDRAWAL_CREATED' || tt === 'WITHDRAWAL_COMPLETED') &&
      amount < 0
    ) {
      wallet.saques += Math.abs(amount);
    } else if (!HANDLED_TYPES.has(tt)) {
      const key = `${tt}::${desc}`;
      const existing = wallet.outros_map.get(key) ?? {
        transaction_type: tt,
        description: desc,
        count: 0,
        total: 0,
        categoria: categorize(tt, desc),
      };
      existing.count++;
      existing.total += amount;
      wallet.outros_map.set(key, existing);
    }
  }
  // Subtrair refunds de afiliados (volta ao bolso do seller).
  wallet.afiliados = Math.max(0, wallet.afiliados - wallet.afiliados_refund);

  // 4. Ads daily no período.
  const ads = emptyAds();
  const fromDate = fromIso.substring(0, 10);
  const toDate = toIso.substring(0, 10);
  const { data: adsRows } = await supabase
    .from('shopee_ads_daily')
    .select('date, expense, broad_gmv')
    .gte('date', fromDate)
    .lte('date', toDate)
    .in('shop_id', shopIds)
    .range(0, 9999);

  for (const a of adsRows ?? []) {
    const expense = num(a.expense);
    ads.expense += expense;
    ads.broad_gmv += num(a.broad_gmv);
    const d = a.date as string;
    ads.by_date.set(d, (ads.by_date.get(d) ?? 0) + expense);
  }

  return { escrow, wallet, ads, pedidos_by_day: pedidosByDay };
}

const CONCILIACAO_KEYS = [
  'PAGO_OK', 'AGUARDANDO_ENVIO', 'EM_TRANSITO', 'ENTREGUE_AGUARDANDO_CONFIRMACAO',
  'AGUARDANDO_LIBERACAO', 'CANCELADO', 'DEVOLVIDO', 'REEMBOLSADO_PARCIAL',
  'EM_DISPUTA', 'ATRASO_DE_REPASSE', 'PAGO_COM_DIVERGENCIA',
  'SEM_VINCULO_FINANCEIRO', 'ORFAO_SHOPEE', 'DADOS_INSUFICIENTES',
];

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }

export async function GET(request: NextRequest) {
  const supabase = createServiceClient();
  const sp = request.nextUrl.searchParams;
  const period = (sp.get('period') as PeriodKey) ?? '7d';
  const fromStr = sp.get('from');
  const toStr = sp.get('to');
  const shopIdStr = sp.get('shop_id') ?? 'all';

  let periodRange;
  try {
    periodRange = computePeriod(period, fromStr, toStr);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'período inválido' },
      { status: 400 },
    );
  }
  const { from, to, label } = periodRange;

  // Período anterior = mesma duração, deslocado para trás.
  const durationMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs + 1);

  // Lojas ativas (para filtro e listagem).
  const { data: shopsData } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name')
    .eq('is_active', true)
    .order('shop_id');
  const allShops = (shopsData as Array<{ shop_id: number; shop_name: string | null }> | null) ?? [];

  let shopIds: number[];
  if (shopIdStr === 'all') {
    shopIds = allShops.map(s => s.shop_id);
  } else {
    const n = Number(shopIdStr);
    if (!Number.isFinite(n)) {
      return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
    }
    shopIds = [n];
  }

  if (shopIds.length === 0) {
    return NextResponse.json({
      period: {
        from: from.toISOString().substring(0, 10),
        to: to.toISOString().substring(0, 10),
        label,
      },
      shops: [],
      shop_filter: shopIdStr,
      kpis: {
        faturamento_bruto: 0, faturamento_bruto_variacao: 0,
        valor_liquido: 0, valor_liquido_pct: 0,
        comissao_media_pct: 0, comissao_media_valor: 0,
        custo_total_shopee_pct: 0,
        comissao_total: 0, comissao_pct: 0,
        taxa_servico_total: 0, taxa_servico_pct: 0,
        ads_total: 0, ads_roas: 0,
        afiliados_total: 0, afiliados_pct: 0,
        rebate_shopee: 0,
        devolucoes_frete: 0, devolucoes_qtd: 0,
        saques_total: 0, outros_custos: 0,
      },
      outros_custos_detalhe: [],
      receita_por_dia: [],
      breakdown_custos: {
        liquido_pct: 0, comissao_pct: 0, taxa_pct: 0,
        ads_pct: 0, afiliados_pct: 0, devolucoes_pct: 0, outros_pct: 0,
      },
      conciliacao: Object.fromEntries(CONCILIACAO_KEYS.map(k => [k, 0])),
      ultimos_pedidos: [],
    });
  }

  // Busca os dois períodos em paralelo.
  const [cur, prev] = await Promise.all([
    fetchPeriod(supabase, from.toISOString(), to.toISOString(), shopIds),
    fetchPeriod(supabase, prevFrom.toISOString(), prevTo.toISOString(), shopIds),
  ]);

  // Conciliação e últimos pedidos em paralelo.
  const [conciliacaoRes, ultimosRes] = await Promise.all([
    supabase
      .from('shopee_conciliacao')
      .select('classificacao')
      .in('shop_id', shopIds)
      .range(0, 49999),
    supabase
      .from('shopee_escrow')
      .select(
        'order_sn, buyer_total_amount, commission_fee, service_fee, escrow_amount, buyer_payment_method, is_released',
      )
      .in('shop_id', shopIds)
      .order('synced_at', { ascending: false })
      .limit(20),
  ]);

  // order_status para os últimos pedidos (via join manual por order_sn).
  const ultimosEscrows =
    (ultimosRes.data as Array<{
      order_sn: string;
      buyer_total_amount: number | null;
      commission_fee: number | null;
      service_fee: number | null;
      escrow_amount: number | null;
      buyer_payment_method: string | null;
      is_released: boolean | null;
    }> | null) ?? [];
  const ultimosStatusMap = new Map<string, string>();
  if (ultimosEscrows.length > 0) {
    const sns = ultimosEscrows.map(e => e.order_sn);
    const { data: sts } = await supabase
      .from('shopee_pedidos')
      .select('order_sn, order_status')
      .in('shop_id', shopIds)
      .in('order_sn', sns);
    for (const s of sts ?? []) {
      ultimosStatusMap.set(s.order_sn as string, (s.order_status as string | null) ?? '');
    }
  }

  const conciliacao: Record<string, number> = Object.fromEntries(
    CONCILIACAO_KEYS.map(k => [k, 0]),
  );
  for (const c of (conciliacaoRes.data as Array<{ classificacao: string }> | null) ?? []) {
    if (c.classificacao in conciliacao) conciliacao[c.classificacao]++;
  }

  // KPIs do período atual
  const bruto = cur.escrow.buyer_total;
  const liquido = cur.escrow.escrow_amount;
  const liquidoPct = bruto > 0 ? (liquido / bruto) * 100 : 0;
  const comissao = cur.escrow.commission_fee;
  const comissaoPct = bruto > 0 ? (comissao / bruto) * 100 : 0;
  const comissaoMediaValor = cur.escrow.count > 0 ? comissao / cur.escrow.count : 0;
  const taxa = cur.escrow.service_fee;
  const taxaPct = bruto > 0 ? (taxa / bruto) * 100 : 0;
  const adsTotal = cur.ads.expense;
  const adsPct = bruto > 0 ? (adsTotal / bruto) * 100 : 0;
  const adsRoas = adsTotal > 0 ? cur.ads.broad_gmv / adsTotal : 0;
  const afiliados = cur.wallet.afiliados;
  const afiliadosPct = bruto > 0 ? (afiliados / bruto) * 100 : 0;
  const devolucoes = cur.wallet.devolucoes;
  const devolucoesPct = bruto > 0 ? (devolucoes / bruto) * 100 : 0;

  const rebate =
    cur.escrow.shopee_discount +
    cur.escrow.voucher_from_shopee +
    cur.escrow.coins +
    cur.escrow.credit_card_promotion +
    cur.escrow.pix_discount;

  // "Outros custos": só o que SAIU (negativos). MONEY_IN aparece no detalhe mas não soma.
  const outrosDetalhe: OutrosGroup[] = Array.from(cur.wallet.outros_map.values());
  let outrosOut = 0;
  for (const g of outrosDetalhe) {
    if (g.total < 0) outrosOut += Math.abs(g.total);
  }
  outrosDetalhe.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const outrosPct = bruto > 0 ? (outrosOut / bruto) * 100 : 0;

  const custoTotalShopee = comissao + taxa + adsTotal + afiliados + devolucoes + outrosOut;
  const custoTotalShopeePct = bruto > 0 ? (custoTotalShopee / bruto) * 100 : 0;

  // Variação vs período anterior
  const prevBruto = prev.escrow.buyer_total;
  const faturamentoVariacao =
    prevBruto > 0 ? ((bruto - prevBruto) / prevBruto) * 100 : bruto > 0 ? 100 : 0;

  // Receita por dia — percorre todos os dias do período (inclui dias zerados)
  const receitaPorDia: Array<{ date: string; bruto: number; liquido: number; ads: number }> = [];
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    const dStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const p = cur.pedidos_by_day.get(dStr) ?? { bruto: 0, liquido: 0 };
    const a = cur.ads.by_date.get(dStr) ?? 0;
    receitaPorDia.push({
      date: dStr,
      bruto: round2(p.bruto),
      liquido: round2(p.liquido),
      ads: round2(a),
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return NextResponse.json({
    period: {
      from: from.toISOString().substring(0, 10),
      to: to.toISOString().substring(0, 10),
      label,
    },
    shops: allShops.map(s => ({ shop_id: s.shop_id, name: s.shop_name })),
    shop_filter: shopIdStr,

    kpis: {
      faturamento_bruto: round2(bruto),
      faturamento_bruto_variacao: round1(faturamentoVariacao),
      valor_liquido: round2(liquido),
      valor_liquido_pct: round1(liquidoPct),
      comissao_media_pct: round1(comissaoPct),
      comissao_media_valor: round2(comissaoMediaValor),
      custo_total_shopee_pct: round1(custoTotalShopeePct),

      comissao_total: round2(comissao),
      comissao_pct: round1(comissaoPct),
      taxa_servico_total: round2(taxa),
      taxa_servico_pct: round1(taxaPct),
      ads_total: round2(adsTotal),
      ads_roas: round2(adsRoas),
      afiliados_total: round2(afiliados),
      afiliados_pct: round1(afiliadosPct),

      rebate_shopee: round2(rebate),
      devolucoes_frete: round2(devolucoes),
      devolucoes_qtd: cur.wallet.devolucoes_qtd,
      saques_total: round2(cur.wallet.saques),
      outros_custos: round2(outrosOut),
    },

    outros_custos_detalhe: outrosDetalhe.map(o => ({
      transaction_type: o.transaction_type,
      description: o.description,
      count: o.count,
      total: round2(o.total),
      categoria: o.categoria,
    })),

    receita_por_dia: receitaPorDia,

    breakdown_custos: {
      liquido_pct: round1(liquidoPct),
      comissao_pct: round1(comissaoPct),
      taxa_pct: round1(taxaPct),
      ads_pct: round1(adsPct),
      afiliados_pct: round1(afiliadosPct),
      devolucoes_pct: round1(devolucoesPct),
      outros_pct: round1(outrosPct),
    },

    conciliacao,

    ultimos_pedidos: ultimosEscrows.map(e => ({
      order_sn: e.order_sn,
      buyer_total_amount: e.buyer_total_amount,
      commission_fee: e.commission_fee,
      service_fee: e.service_fee,
      escrow_amount: e.escrow_amount,
      buyer_payment_method: e.buyer_payment_method,
      is_released: e.is_released ?? false,
      order_status: ultimosStatusMap.get(e.order_sn) ?? null,
    })),
  });
}
