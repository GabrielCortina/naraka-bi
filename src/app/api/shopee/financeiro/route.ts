import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase-server';

// Dashboard financeiro Shopee (fase 3 — rebuild). Toda classificação de
// transação da wallet vem da tabela shopee_transaction_mapping — se a
// Shopee criar um tipo novo, basta inserir uma linha lá.
//
// Filtros por período seguem a data de movimentação financeira:
//   - escrow: escrow_release_time (is_released=true) — quando o dinheiro foi liberado
//   - wallet: create_time — débito/crédito na carteira
//   - ads: date — data do gasto
//   - cobertura financeira, receita pendente: globais (sem filtro de período)
//
// Query:
//   ?period=today|yesterday|7d|15d|month|last_month|custom
//   ?from=YYYY-MM-DD & to=YYYY-MM-DD (quando period=custom)
//   ?shop_id=all|<id>

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const DAY_MS = 86400000;
const BR_OFFSET_HOURS = 3; // America/Sao_Paulo é UTC-3 (sem DST desde 2019).
const BR_OFFSET_MS = BR_OFFSET_HOURS * 3600_000;

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

// Extrai os componentes de data "no relógio" BRT a partir de um instante UTC.
// Subtrair 3h e ler os componentes UTC é equivalente a ler no fuso -03:00.
function brParts(d: Date): { y: number; m: number; day: number } {
  const shifted = new Date(d.getTime() - BR_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

// 00:00 BRT de uma data qualquer, como instante UTC (03:00 UTC).
function startOfDayBRT(d: Date): Date {
  const { y, m, day } = brParts(d);
  return new Date(Date.UTC(y, m, day, BR_OFFSET_HOURS, 0, 0, 0));
}

// 23:59:59.999 BRT → 02:59:59.999 UTC do dia seguinte.
function endOfDayBRT(d: Date): Date {
  const { y, m, day } = brParts(d);
  return new Date(Date.UTC(y, m, day + 1, BR_OFFSET_HOURS - 1, 59, 59, 999));
}

// Formato "YYYY-MM-DD" da data BR correspondente ao instante.
function brDateString(d: Date): string {
  const { y, m, day } = brParts(d);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Constrói 00:00 BRT para um triple (ano, mês 0-based, dia).
function startOfBrDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, BR_OFFSET_HOURS, 0, 0, 0));
}
function endOfBrDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day + 1, BR_OFFSET_HOURS - 1, 59, 59, 999));
}

function computePeriod(
  period: PeriodKey,
  fromStr: string | null,
  toStr: string | null,
): { from: Date; to: Date; label: string } {
  const now = new Date();
  const { y: nowY, m: nowM, day: nowD } = brParts(now);

  let from: Date;
  let to: Date;

  switch (period) {
    case 'today':
      from = startOfDayBRT(now); to = endOfDayBRT(now); break;
    case 'yesterday': {
      from = startOfBrDate(nowY, nowM, nowD - 1);
      to = endOfBrDate(nowY, nowM, nowD - 1);
      break;
    }
    case '7d':
      from = startOfBrDate(nowY, nowM, nowD - 6);
      to = endOfDayBRT(now);
      break;
    case '15d':
      from = startOfBrDate(nowY, nowM, nowD - 14);
      to = endOfDayBRT(now);
      break;
    case 'month':
      from = startOfBrDate(nowY, nowM, 1);
      to = endOfDayBRT(now);
      break;
    case 'last_month': {
      from = startOfBrDate(nowY, nowM - 1, 1);
      // último dia do mês anterior = dia 0 do mês atual.
      const lastDayPrevMonth = new Date(Date.UTC(nowY, nowM, 0)).getUTCDate();
      to = endOfBrDate(nowY, nowM - 1, lastDayPrevMonth);
      break;
    }
    case 'custom': {
      if (!fromStr || !toStr) throw new Error('period=custom requer from e to');
      const fParts = fromStr.split('-').map(Number);
      const tParts = toStr.split('-').map(Number);
      if (fParts.length !== 3 || tParts.length !== 3 || fParts.some(n => !Number.isFinite(n)) || tParts.some(n => !Number.isFinite(n))) {
        throw new Error('from/to inválidos');
      }
      from = startOfBrDate(fParts[0], fParts[1] - 1, fParts[2]);
      to = endOfBrDate(tParts[0], tParts[1] - 1, tParts[2]);
      if (to < from) throw new Error('from/to inválidos');
      break;
    }
    default:
      from = startOfBrDate(nowY, nowM, nowD - 6);
      to = endOfDayBRT(now);
  }

  return { from, to, label: PERIOD_LABELS[period] ?? '—' };
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function pctOf(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

// ---------- tipos internos ----------

interface MappingRow {
  transaction_type: string;
  classificacao: string;
  kpi_destino: string;
  descricao_pt: string;
  entra_no_custo_total: boolean;
  duplica_com: string | null;
  natureza: string;
}

interface EscrowAggr {
  // Contagens
  count: number;              // todas as linhas liberadas no período
  count_with_detail: number;  // linhas onde escrow_amount/buyer_total NÃO são NULL

  // GMV e receita líquida — aplicam COALESCE(...,payout_amount,0). Cobrem
  // TODAS as linhas, inclusive as que ainda não tiveram detail completo.
  buyer_total: number;
  escrow_amount: number;

  // Base para percentuais — só linhas COM detail (senão o denominador
  // infla e a % sai subestimada).
  buyer_total_with_detail: number;

  // Fees e subsídios — só existem em linhas com detail. Usar com o
  // denominador buyer_total_with_detail.
  order_discounted_price: number;
  commission_fee: number;
  service_fee: number;
  seller_transaction_fee: number;
  credit_card_transaction_fee: number;  // taxa de cartão cobrada do seller
  fbs_fee: number;
  processing_fee: number; // não existe na tabela → fica 0 (placeholder)
  order_ams_commission_fee: number;     // afiliados por pedido (fonte alternativa à wallet)
  shopee_discount: number;
  voucher_from_shopee: number;
  voucher_from_seller: number;
  seller_discount: number;
  coins: number;
  credit_card_promotion: number;
  pix_discount: number;
  shopee_shipping_rebate: number;       // informativo; NÃO entra no subsídio
  reverse_shipping_fee_total: number;
  reverse_shipping_fee_positive: number;
  reverse_shipping_fee_count: number;
  // Frete de ida pago pelo seller em pedidos devolvidos — acumula
  // actual_shipping_fee quando reverse_shipping_fee > 0 E
  // shopee_shipping_rebate = 0 (Shopee não ressarciu).
  frete_ida_devolvido: number;
  negative_escrow_count: number;
  negative_escrow_total: number;
}
function emptyEscrow(): EscrowAggr {
  return {
    count: 0, count_with_detail: 0,
    buyer_total: 0, escrow_amount: 0, buyer_total_with_detail: 0,
    order_discounted_price: 0,
    commission_fee: 0, service_fee: 0, seller_transaction_fee: 0,
    credit_card_transaction_fee: 0,
    fbs_fee: 0, processing_fee: 0,
    order_ams_commission_fee: 0,
    shopee_discount: 0, voucher_from_shopee: 0, voucher_from_seller: 0,
    seller_discount: 0, coins: 0, credit_card_promotion: 0, pix_discount: 0,
    shopee_shipping_rebate: 0,
    reverse_shipping_fee_total: 0, reverse_shipping_fee_positive: 0, reverse_shipping_fee_count: 0,
    frete_ida_devolvido: 0,
    negative_escrow_count: 0, negative_escrow_total: 0,
  };
}

interface OutrosGroup {
  transaction_type: string;
  description: string;
  classificacao: string;
  count: number;
  total: number;
}
interface CompensacaoGroup {
  description: string;
  count: number;
  total: number;
}
interface WalletAggr {
  afiliados_debito: number;
  afiliados_credito: number;
  devolucao_total: number;
  devolucao_qtd: number;
  difal_total: number;
  difal_qtd: number;
  pedidos_negativos_total: number;
  pedidos_negativos_qtd: number;
  fbs_debito: number;
  fbs_credito: number;
  outros_debito: number;
  outros_credito: number;
  saques_total: number;
  saques_qtd: number;
  compensacoes_total: number;
  compensacoes_qtd: number;
  compensacoes_detail: Map<string, CompensacaoGroup>;
  outros_detail: Map<string, OutrosGroup>;
}
function emptyWallet(): WalletAggr {
  return {
    afiliados_debito: 0, afiliados_credito: 0,
    devolucao_total: 0, devolucao_qtd: 0,
    difal_total: 0, difal_qtd: 0,
    pedidos_negativos_total: 0, pedidos_negativos_qtd: 0,
    fbs_debito: 0, fbs_credito: 0,
    outros_debito: 0, outros_credito: 0,
    saques_total: 0, saques_qtd: 0,
    compensacoes_total: 0, compensacoes_qtd: 0,
    compensacoes_detail: new Map<string, CompensacaoGroup>(),
    outros_detail: new Map<string, OutrosGroup>(),
  };
}

interface AdsAggr {
  expense: number;
  broad_gmv: number;
  by_date: Map<string, number>;
}
function emptyAds(): AdsAggr { return { expense: 0, broad_gmv: 0, by_date: new Map() }; }

interface PeriodData {
  escrow: EscrowAggr;
  wallet: WalletAggr;
  ads: AdsAggr;
  pedidos_by_day: Map<string, { gmv: number; liquido: number; comissao: number; taxa: number }>;
}

async function loadMapping(supabase: SupabaseClient): Promise<Map<string, MappingRow>> {
  const { data } = await supabase
    .from('shopee_transaction_mapping')
    .select('transaction_type, classificacao, kpi_destino, descricao_pt, entra_no_custo_total, duplica_com, natureza');

  const map = new Map<string, MappingRow>();
  for (const r of (data as MappingRow[] | null) ?? []) {
    map.set(r.transaction_type, r);
  }
  return map;
}

async function fetchPeriod(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string,
  shopIds: number[],
  mapping: Map<string, MappingRow>,
): Promise<PeriodData> {
  const escrow = emptyEscrow();
  const pedidosByDay = new Map<string, { gmv: number; liquido: number; comissao: number; taxa: number }>();

  // 1. Escrow liberado no período — filtra pela data do release (movimentação
  // financeira real). Escrows pendentes (is_released=false) ficam fora; são
  // expostos separadamente como "receita pendente" (global, sem filtro).
  //
  // IMPORTANTE: Supabase/PostgREST limita respostas a 1000 linhas por default
  // (max-rows do projeto). Usamos PAGE=1000 para paginação consistente —
  // valores maiores retornariam só 1000 e o `rows.length < PAGE` abortaria o
  // loop achando que acabou (bug observado na OxeanJeans com 5.6k escrows/7d).
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows } = await supabase
      .from('shopee_escrow')
      .select(
        'buyer_total_amount, escrow_amount, payout_amount, order_discounted_price, commission_fee, service_fee, seller_transaction_fee, credit_card_transaction_fee, fbs_fee, order_ams_commission_fee, shopee_discount, voucher_from_shopee, voucher_from_seller, seller_discount, coins, credit_card_promotion, pix_discount, shopee_shipping_rebate, reverse_shipping_fee, actual_shipping_fee, escrow_release_time',
      )
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .gte('escrow_release_time', fromIso)
      .lte('escrow_release_time', toIso)
      .range(offset, offset + PAGE - 1);

    if (!rows || rows.length === 0) break;

    for (const r of rows) {
      escrow.count++;

      // GMV (bruto) só existe quando o escrow_detail foi sincronizado —
      // payout_amount é LÍQUIDO, não bruto. Usar payout como fallback para
      // GMV igualaria "bruto = líquido" (100%), mascarando comissão e taxas.
      const buyerRaw = r.buyer_total_amount;
      const hasBuyerTotal = buyerRaw != null && num(buyerRaw) !== 0;
      const b = hasBuyerTotal ? num(buyerRaw) : 0;

      // Receita líquida pode usar payout_amount como fallback — ambos são
      // o valor líquido que caiu/cairá na carteira.
      const payout = num(r.payout_amount);
      const a = r.escrow_amount != null ? num(r.escrow_amount) : payout;

      const com = num(r.commission_fee);
      const svc = num(r.service_fee);

      escrow.buyer_total += b;
      escrow.escrow_amount += a;

      // "Detail completo" = temos escrow_detail sincronizado (buyer_total OU
      // escrow_amount não-nulos — por padrão, ambos vêm juntos).
      const hasDetail = hasBuyerTotal || r.escrow_amount != null;

      if (hasDetail) {
        escrow.count_with_detail++;
        escrow.buyer_total_with_detail += num(r.buyer_total_amount);

        escrow.order_discounted_price += num(r.order_discounted_price);
        escrow.commission_fee += com;
        escrow.service_fee += svc;
        escrow.seller_transaction_fee += num(r.seller_transaction_fee);
        escrow.credit_card_transaction_fee += num(r.credit_card_transaction_fee);
        escrow.fbs_fee += num(r.fbs_fee);
        escrow.order_ams_commission_fee += num(r.order_ams_commission_fee);
        escrow.shopee_discount += num(r.shopee_discount);
        escrow.voucher_from_shopee += num(r.voucher_from_shopee);
        escrow.voucher_from_seller += num(r.voucher_from_seller);
        escrow.seller_discount += num(r.seller_discount);
        escrow.coins += num(r.coins);
        escrow.credit_card_promotion += num(r.credit_card_promotion);
        escrow.pix_discount += num(r.pix_discount);
        escrow.shopee_shipping_rebate += num(r.shopee_shipping_rebate);

        const rsf = num(r.reverse_shipping_fee);
        escrow.reverse_shipping_fee_total += rsf;
        if (rsf > 0) {
          escrow.reverse_shipping_fee_positive += rsf;
          escrow.reverse_shipping_fee_count++;

          // Frete de ida só entra como custo se a Shopee NÃO ressarciu o seller.
          // shopee_shipping_rebate > 0 = Shopee pagou parte/todo frete → não é custo do seller.
          const rebate = num(r.shopee_shipping_rebate);
          const asf = num(r.actual_shipping_fee);
          if (rebate === 0 && asf > 0) {
            escrow.frete_ida_devolvido += asf;
          }
        }
      }

      if (a < 0) {
        escrow.negative_escrow_count++;
        escrow.negative_escrow_total += Math.abs(a);
      }

      // Série diária por DATE(escrow_release_time) NO FUSO BRT. Um release
      // às 02:00 UTC é ainda "ontem" no Brasil — o bucket precisa refletir isso.
      const rt = r.escrow_release_time as string | null;
      if (rt) {
        const date = brDateString(new Date(rt));
        const e = pedidosByDay.get(date) ?? { gmv: 0, liquido: 0, comissao: 0, taxa: 0 };
        e.gmv += b;
        e.liquido += a;
        e.comissao += com;
        e.taxa += svc;
        pedidosByDay.set(date, e);
      }
    }

    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // 3. Wallet no período — paginado (mesma limitação de 1000 do PostgREST).
  const wallet = emptyWallet();
  const walletRows: Array<{ transaction_type: string; amount: number; description: string | null; create_time: string | null }> = [];
  {
    let wOffset = 0;
    while (true) {
      const { data: page } = await supabase
        .from('shopee_wallet')
        .select('transaction_type, amount, description, create_time')
        .gte('create_time', fromIso)
        .lte('create_time', toIso)
        .in('shop_id', shopIds)
        .range(wOffset, wOffset + PAGE - 1);
      if (!page || page.length === 0) break;
      walletRows.push(...(page as typeof walletRows));
      if (page.length < PAGE) break;
      wOffset += PAGE;
    }
  }

  // Derivamos sets por kpi_destino uma única vez por loja a partir do
  // mapping — nenhum transaction_type é hardcoded no roteamento dos KPIs.
  // Para adicionar suporte a um tipo novo, basta inserir uma linha em
  // shopee_transaction_mapping com o kpi_destino desejado.
  const typesByKpi = new Map<string, Set<string>>();
  for (const [tt, m] of Array.from(mapping.entries())) {
    let set = typesByKpi.get(m.kpi_destino);
    if (!set) { set = new Set<string>(); typesByKpi.set(m.kpi_destino, set); }
    set.add(tt);
  }
  const emptySet = new Set<string>();
  const afiliadosTypes         = typesByKpi.get('afiliados')         ?? emptySet;
  const devolucaoTypes         = typesByKpi.get('devolucao')         ?? emptySet;
  const difalTypes             = typesByKpi.get('difal')             ?? emptySet;
  const pedidosNegativosTypes  = typesByKpi.get('pedidos_negativos') ?? emptySet;
  const fbsTypes               = typesByKpi.get('fbs')               ?? emptySet;
  const saqueTypes             = typesByKpi.get('saque')             ?? emptySet;
  const compensacaoTypes       = typesByKpi.get('compensacao')       ?? emptySet;
  const ignorarTypes           = typesByKpi.get('ignorar')           ?? emptySet;

  // Kpis cujos valores são contabilizados em OUTRA tabela-fonte autoritativa
  // e NÃO devem aparecer no roteamento da wallet — senão viram double count
  // ou caem no bucket "outros" como receita (caso do ESCROW_VERIFIED_ADD,
  // que é receita_escrow: vem do shopee_escrow).
  //   - receita_escrow / comissao / taxa → shopee_escrow
  //   - ads → shopee_ads_daily
  const elsewhereTypes = new Set<string>();
  for (const kpi of ['receita_escrow', 'comissao', 'taxa', 'ads']) {
    const s = typesByKpi.get(kpi);
    if (s) for (const tt of Array.from(s)) elsewhereTypes.add(tt);
  }

  // Compensações: detectadas por (a) mapping kpi_destino='compensacao',
  // (b) transaction_type vazio + description contém "objeto perdido"/"reembolso",
  // (c) ADJUSTMENT_ADD + description indica compensação/extravio.
  // A detecção por description cobre lançamentos que chegam com tipo em
  // branco — sem ela, ficariam em "outros" sem classificação financeira real.
  const matchCompensationByDescription = (tt: string, descLower: string): boolean => {
    if (tt === '' && (descLower.includes('objeto perdido') || descLower.includes('reembolso'))) {
      return true;
    }
    if (tt === 'ADJUSTMENT_ADD' && (
      descLower.includes('compensation') ||
      descLower.includes('perdido') ||
      descLower.includes('danificado') ||
      descLower.includes('extraviado')
    )) {
      return true;
    }
    return false;
  };

  for (const w of walletRows) {
    const tt = ((w.transaction_type as string) ?? '').trim();
    const amount = num(w.amount);
    const desc = ((w.description as string | null) ?? '').trim();
    const m = mapping.get(tt); // undefined quando o tipo ainda não foi mapeado

    // Ignorar: tipo marcado explicitamente como 'ignorar' (ads duplicados etc.).
    if (ignorarTypes.has(tt) || m?.classificacao === 'ignorar') continue;

    // Kpis contabilizados em outra tabela-fonte (ESCROW_VERIFIED_ADD →
    // shopee_escrow; ads na shopee_ads_daily). Pular aqui evita que receita
    // vire "outros custos" e que ads seja contado duas vezes.
    if (elsewhereTypes.has(tt)) continue;

    // Defensivo: duplica_com aponta para fonte autoritativa ≠ shopee_escrow
    // (tipicamente shopee_ads_daily). Esses já caíram no check acima quando
    // tinham kpi_destino compatível; este é o último filtro antes do roteamento.
    if (m?.duplica_com && m.duplica_com !== 'shopee_escrow') {
      continue;
    }

    // Natureza: do mapping quando existe; senão inferimos do sinal.
    const isCredito = m ? m.natureza === 'credito' : amount > 0;
    const abs = Math.abs(amount);

    // Compensações têm prioridade sobre o roteamento normal — o lançamento
    // pode ter tipo em branco (sem mapping) ou vir como ADJUSTMENT_ADD
    // (genérico). Só contamos valores positivos: é dinheiro que ENTRA.
    const descLower = desc.toLowerCase();
    if (compensacaoTypes.has(tt) || matchCompensationByDescription(tt, descLower)) {
      if (amount > 0) {
        wallet.compensacoes_total += amount;
        wallet.compensacoes_qtd++;
        const key = (desc || tt || '(compensação)').trim() || '(compensação)';
        const g = wallet.compensacoes_detail.get(key) ?? { description: key, count: 0, total: 0 };
        g.count++;
        g.total += amount;
        wallet.compensacoes_detail.set(key, g);
      }
      continue;
    }

    if (afiliadosTypes.has(tt)) {
      if (isCredito || amount > 0) wallet.afiliados_credito += abs;
      else wallet.afiliados_debito += abs;
    } else if (devolucaoTypes.has(tt)) {
      wallet.devolucao_total += abs;
      wallet.devolucao_qtd++;
    } else if (difalTypes.has(tt)) {
      wallet.difal_total += abs;
      wallet.difal_qtd++;
    } else if (pedidosNegativosTypes.has(tt)) {
      wallet.pedidos_negativos_total += abs;
      wallet.pedidos_negativos_qtd++;
    } else if (fbsTypes.has(tt)) {
      if (isCredito || amount > 0) wallet.fbs_credito += abs;
      else wallet.fbs_debito += abs;
    } else if (saqueTypes.has(tt)) {
      // Só conta saque quando SAIU dinheiro (débito).
      if (amount < 0) {
        wallet.saques_total += abs;
        wallet.saques_qtd++;
      }
    } else {
      // Default: 'outros'. Abrange tanto tipos mapeados com kpi_destino='outros'
      // quanto tipos ainda não presentes na tabela de mapping — ambos caem aqui
      // sem precisar de hardcode. Os detalhes viram um breakdown para a UI.
      if (isCredito || amount > 0) wallet.outros_credito += abs;
      else wallet.outros_debito += abs;

      const key = `${tt}::${desc}`;
      const existing = wallet.outros_detail.get(key) ?? {
        transaction_type: tt,
        description: desc || m?.descricao_pt || tt || '(sem descrição)',
        classificacao: m?.classificacao ?? 'custo_friccao',
        count: 0,
        total: 0,
      };
      existing.count++;
      existing.total += amount;
      wallet.outros_detail.set(key, existing);
    }
  }

  // 4. Ads daily no período (única fonte de ads). Coluna `date` é DATE
  // (sem fuso) — comparamos usando a data BR dos limites do período.
  const ads = emptyAds();
  const fromDate = brDateString(new Date(fromIso));
  const toDate = brDateString(new Date(toIso));
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

  // Diagnóstico: se o dashboard mostrar ads zerados ou muito baixos, geralmente
  // é porque a tabela tem só alguns dias sincronizados. Loga janela + linhas.
  console.log(
    `[financeiro] ads filter shop_ids=${shopIds.join(',')} from=${fromDate} to=${toDate} rows=${adsRows?.length ?? 0} expense=${ads.expense.toFixed(2)}`,
  );

  return {
    escrow,
    wallet,
    ads,
    pedidos_by_day: pedidosByDay,
  };
}

const CONCILIACAO_KEYS = [
  'PAGO_OK', 'AGUARDANDO_ENVIO', 'EM_TRANSITO', 'ENTREGUE_AGUARDANDO_CONFIRMACAO',
  'AGUARDANDO_LIBERACAO', 'CANCELADO', 'DEVOLVIDO', 'REEMBOLSADO_PARCIAL',
  'EM_DISPUTA', 'ATRASO_DE_REPASSE', 'PAGO_COM_DIVERGENCIA',
  'SEM_VINCULO_FINANCEIRO', 'ORFAO_SHOPEE', 'DADOS_INSUFICIENTES',
];

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

  // Período anterior (mesma duração, deslocado para trás).
  const durationMs = to.getTime() - from.getTime() + 1;
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - durationMs + 1);

  // Lojas ativas.
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
    return NextResponse.json(emptyPayload(from, to, label, shopIdStr, allShops));
  }

  const mapping = await loadMapping(supabase);

  const [cur, prev] = await Promise.all([
    fetchPeriod(supabase, from.toISOString(), to.toISOString(), shopIds, mapping),
    fetchPeriod(supabase, prevFrom.toISOString(), prevTo.toISOString(), shopIds, mapping),
  ]);

  // Conciliação + últimos pedidos liberados + saldo wallet + cobertura global + receita pendente em paralelo.
  // Conciliação é paginada (pode passar de 1000 linhas — PostgREST limita por default).
  //
  // Cobertura financeira:
  //   - denominador = pedidos QUE DEVERIAM ter escrow (status COMPLETED, SHIPPED,
  //     TO_CONFIRM_RECEIVE). Status como UNPAID/CANCELLED não geram escrow.
  //   - numerador   = escrows com detail REAL (escrow_amount não-nulo e ≠ 0).
  //     Stubs criados pelo fix-wallet-releases (escrow_amount NULL ou 0) não
  //     contam — senão aparece > 100% quando há mais stubs do que pedidos.
  const [
    conciliacaoRows, ultimosRes, walletBalanceRes,
    pedidosEsperandoEscrowRes, escrowsComDetailRes,
  ] = await Promise.all([
    (async () => {
      const out: Array<{ classificacao: string }> = [];
      let off = 0;
      const SIZE = 1000;
      while (true) {
        const { data } = await supabase
          .from('shopee_conciliacao')
          .select('classificacao')
          .in('shop_id', shopIds)
          .range(off, off + SIZE - 1);
        if (!data || data.length === 0) break;
        out.push(...(data as Array<{ classificacao: string }>));
        if (data.length < SIZE) break;
        off += SIZE;
      }
      return out;
    })(),
    supabase
      .from('shopee_escrow')
      .select(
        'order_sn, buyer_total_amount, commission_fee, service_fee, escrow_amount, buyer_payment_method, is_released, reverse_shipping_fee, order_ams_commission_fee, escrow_release_time',
      )
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .order('escrow_release_time', { ascending: false })
      .limit(20),
    supabase
      .from('shopee_wallet')
      .select('current_balance')
      .in('shop_id', shopIds)
      .not('current_balance', 'is', null)
      .order('create_time', { ascending: false })
      .limit(1),
    supabase
      .from('shopee_pedidos')
      .select('*', { count: 'exact', head: true })
      .in('shop_id', shopIds)
      .in('order_status', ['COMPLETED', 'SHIPPED', 'TO_CONFIRM_RECEIVE']),
    supabase
      .from('shopee_escrow')
      .select('*', { count: 'exact', head: true })
      .in('shop_id', shopIds)
      .not('escrow_amount', 'is', null)
      .neq('escrow_amount', 0),
  ]);

  // Receita pendente = soma dos valores a liberar com valor POSITIVO. Escrows
  // com escrow_amount <= 0 (devoluções, cancelamentos, stubs) não são receita
  // futura — ignoramos. Quando escrow_amount é NULL mas payout_amount > 0
  // (stub criado pelo wallet com valor do release), usamos payout como proxy.
  // Resultado final é clampado em ≥ 0 por segurança.
  let receitaPendente = 0;
  {
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data: rows } = await supabase
        .from('shopee_escrow')
        .select('escrow_amount, payout_amount')
        .in('shop_id', shopIds)
        .eq('is_released', false)
        .range(offset, offset + PAGE - 1);
      if (!rows || rows.length === 0) break;
      for (const r of rows) {
        const ea = r.escrow_amount;
        const pa = r.payout_amount;
        if (ea != null) {
          const eaNum = num(ea);
          if (eaNum > 0) receitaPendente += eaNum;
        } else {
          const paNum = num(pa);
          if (paNum > 0) receitaPendente += paNum;
        }
      }
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }
  receitaPendente = Math.max(0, receitaPendente);

  const pedidosEsperandoEscrow = pedidosEsperandoEscrowRes.count ?? 0;
  const escrowsComDetail = escrowsComDetailRes.count ?? 0;

  const ultimosEscrows =
    (ultimosRes.data as Array<{
      order_sn: string;
      buyer_total_amount: number | null;
      commission_fee: number | null;
      service_fee: number | null;
      escrow_amount: number | null;
      buyer_payment_method: string | null;
      is_released: boolean | null;
      reverse_shipping_fee: number | null;
      order_ams_commission_fee: number | null;
      escrow_release_time: string | null;
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
  for (const c of conciliacaoRows) {
    if (c.classificacao in conciliacao) conciliacao[c.classificacao]++;
  }

  const saldoWallet = num((walletBalanceRes.data as Array<{ current_balance: number }> | null)?.[0]?.current_balance);

  // =================== KPIs ===================

  // GMV / receita líquida — todas as linhas, com COALESCE(...,payout_amount,0)
  // já aplicado no loop do fetchPeriod. Ou seja, inclui as linhas cujo detail
  // ainda não foi buscado (fallback pelo payout_amount do escrow-list).
  const gmv = cur.escrow.buyer_total;
  const receitaLiquida = cur.escrow.escrow_amount;
  const ticketMedio = cur.escrow.count > 0 ? gmv / cur.escrow.count : 0;

  // Base de percentuais que dependem de campos do detail (comissão, taxa,
  // subsídios, etc.) — só conta linhas que têm detail completo. Evita
  // subestimar a % quando parte das linhas ainda está sem detail.
  const gmvDetail = cur.escrow.buyer_total_with_detail;
  const countWithDetail = cur.escrow.count_with_detail;
  const detailCoverage = pctOf(countWithDetail, cur.escrow.count);

  const precoMedioEfetivo = countWithDetail > 0
    ? cur.escrow.order_discounted_price / countWithDetail
    : 0;

  // Take rate: comissão + taxa de serviço (somas são baseadas em detail).
  const takeRateValor = cur.escrow.commission_fee + cur.escrow.service_fee;

  // Custos plataforma — inclui taxa de cartão (credit_card_transaction_fee),
  // que estava sendo ignorada e custa ~R$ 300/dia de acordo com a OxeanJeans.
  const taxaCartao = cur.escrow.credit_card_transaction_fee;
  const plataformaOutros =
    cur.escrow.seller_transaction_fee +
    taxaCartao +
    cur.escrow.fbs_fee +
    cur.escrow.processing_fee;
  const plataformaTotal = takeRateValor + plataformaOutros;

  // Custos aquisição
  const adsExpense = cur.ads.expense;
  const adsRoas = adsExpense > 0 ? cur.ads.broad_gmv / adsExpense : 0;
  // TACOS = expense / broad_gmv (tudo da mesma fonte: shopee_ads_daily).
  // Usar GMV do escrow como denominador infla o TACOS quando o backfill
  // do detail está incompleto, porque expense é integral mas GMV é parcial.
  const adsTacos = pctOf(adsExpense, cur.ads.broad_gmv);

  // Afiliados: duas fontes possíveis. Wallet (AFFILIATE_*) pode não ter
  // registros para o período; o escrow tem order_ams_commission_fee por
  // pedido. Pegamos o maior — se uma fonte está vazia, a outra cobre.
  const afiliadosWallet = Math.max(0, cur.wallet.afiliados_debito - cur.wallet.afiliados_credito);
  const afiliadosEscrow = cur.escrow.order_ams_commission_fee;
  const afiliadosLiquido = Math.max(afiliadosWallet, afiliadosEscrow);
  const aquisicaoTotal = adsExpense + afiliadosLiquido;

  // Custos fricção
  const devolucoesTotalWallet = cur.wallet.devolucao_total;
  const freteReverso = cur.escrow.reverse_shipping_fee_positive;
  const freteIdaSeller = cur.escrow.frete_ida_devolvido;
  // Custo real de devolução = frete reverso (volta até o seller) +
  // frete de ida que o seller bancou em pedidos devolvidos sem rebate.
  const devolucoesCustoTotal = freteReverso + freteIdaSeller;
  const devolucoesReversaoReceita = Math.max(0, devolucoesTotalWallet - freteReverso);
  const difal = cur.wallet.difal_total;
  // pedidos_negativos fica INFORMATIVO — o custo real já está em
  // devolucoesCustoTotal (frete reverso + ida). Somar aqui seria double count.
  const pedidosNegativos = cur.wallet.pedidos_negativos_total;
  const fbsCustosLiquido = Math.max(0, cur.wallet.fbs_debito - cur.wallet.fbs_credito);
  const outrosCustos = Math.max(0, cur.wallet.outros_debito - cur.wallet.outros_credito);

  // FRICÇÃO usa o custo total de devoluções (reverso + ida) e NÃO inclui
  // pedidos_negativos (já contabilizado no custo real das devoluções).
  const friccaoTotal =
    devolucoesCustoTotal + difal + fbsCustosLiquido + outrosCustos;

  const custoTotal = plataformaTotal + aquisicaoTotal + friccaoTotal;

  // Margem operacional: receita líquida menos TODOS os custos não-plataforma.
  // (Comissão e taxa já estão debitados no escrow_amount — não subtrair de novo).
  // pedidos_negativos fica fora pelo mesmo motivo do friccaoTotal.
  const margemValor = receitaLiquida
    - adsExpense - afiliadosLiquido
    - devolucoesCustoTotal - difal - fbsCustosLiquido - outrosCustos;

  // Subsídio Shopee — o que a Shopee BANCOU do bolso dela (desconto, voucher,
  // coins, promo cartão, pix discount). NÃO inclui shopee_shipping_rebate:
  // frete "grátis" não é subsídio — está embutido na taxa de serviço que o
  // seller paga, logo é custo dele, não presente da Shopee.
  const subsidioTotal =
    cur.escrow.shopee_discount +
    cur.escrow.voucher_from_shopee +
    cur.escrow.coins +
    cur.escrow.credit_card_promotion +
    cur.escrow.pix_discount;

  // Cobertura financeira — global (não filtra por período). Denominador só
  // conta pedidos que deveriam ter escrow (COMPLETED/SHIPPED/TO_CONFIRM_RECEIVE);
  // numerador só conta escrows com detail real. Limitamos em 100% porque
  // stubs remanescentes podem inflar o numerador, mas a cobertura "útil"
  // nunca deve passar de 100%. Se não há pedidos elegíveis, 100%.
  const coberturaRaw = pedidosEsperandoEscrow > 0
    ? pctOf(escrowsComDetail, pedidosEsperandoEscrow)
    : 100;
  const cobertura = Math.min(coberturaRaw, 100);
  const pedidosSemEscrow = Math.max(0, pedidosEsperandoEscrow - escrowsComDetail);

  // Variação GMV/receita líquida
  const gmvVariacao =
    prev.escrow.buyer_total > 0
      ? ((gmv - prev.escrow.buyer_total) / prev.escrow.buyer_total) * 100
      : gmv > 0 ? 100 : 0;
  const receitaLiquidaVariacao =
    prev.escrow.escrow_amount > 0
      ? ((receitaLiquida - prev.escrow.escrow_amount) / prev.escrow.escrow_amount) * 100
      : receitaLiquida > 0 ? 100 : 0;

  // Outros custos detalhe (ordenado por |total|).
  const outrosDetalhe = Array.from(cur.wallet.outros_detail.values())
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))
    .map(o => ({
      transaction_type: o.transaction_type,
      description: o.description,
      classificacao: o.classificacao,
      count: o.count,
      total: round2(o.total),
    }));

  // Gráfico: receita por dia (preenche dias zerados). Itera em passos de
  // 1 dia BRT. Como `from` é 03:00 UTC (=00:00 BRT), somar 24h mantém o
  // cursor em 00:00 BRT do dia seguinte.
  const receitaPorDia: Array<{
    date: string;
    gmv: number; liquido: number; ads: number; custos_plataforma: number;
  }> = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    const dStr = brDateString(new Date(t));
    const p = cur.pedidos_by_day.get(dStr) ?? { gmv: 0, liquido: 0, comissao: 0, taxa: 0 };
    const adsDay = cur.ads.by_date.get(dStr) ?? 0;
    receitaPorDia.push({
      date: dStr,
      gmv: round2(p.gmv),
      liquido: round2(p.liquido),
      ads: round2(adsDay),
      custos_plataforma: round2(p.comissao + p.taxa),
    });
  }

  // Distribuição (% do GMV).
  const liquidoAposCustos = gmv - custoTotal;
  const distribuicao = {
    liquido_pct: round1(pctOf(liquidoAposCustos, gmv)),
    plataforma_pct: round1(pctOf(plataformaTotal, gmv)),
    ads_pct: round1(pctOf(adsExpense, gmv)),
    afiliados_pct: round1(pctOf(afiliadosLiquido, gmv)),
    difal_pct: round1(pctOf(difal, gmv)),
    devolucoes_frete_pct: round1(pctOf(devolucoesCustoTotal, gmv)),
    outros_pct: round1(pctOf(fbsCustosLiquido + outrosCustos, gmv)),
  };

  return NextResponse.json({
    period: {
      from: brDateString(from),
      to: brDateString(to),
      label,
    },
    shops: allShops.map(s => ({ shop_id: s.shop_id, name: s.shop_name })),
    shop_filter: shopIdStr,

    receita: {
      gmv: round2(gmv),
      gmv_variacao: round1(gmvVariacao),
      receita_liquida: round2(receitaLiquida),
      receita_liquida_pct: round1(pctOf(receitaLiquida, gmv)),
      receita_liquida_variacao: round1(receitaLiquidaVariacao),
      ticket_medio: round2(ticketMedio),
      preco_medio_efetivo: round2(precoMedioEfetivo),
      total_pedidos: cur.escrow.count,
      total_pecas: 0, // quantidade de itens não está persistida
    },

    take_rate: {
      percentual: round1(pctOf(takeRateValor, gmvDetail)),
      valor: round2(takeRateValor),
    },

    custos: {
      plataforma: {
        total: round2(plataformaTotal),
        pct_gmv: round1(pctOf(plataformaTotal, gmvDetail)),
        comissao: round2(cur.escrow.commission_fee),
        comissao_pct: round1(pctOf(cur.escrow.commission_fee, gmvDetail)),
        taxa_servico: round2(cur.escrow.service_fee),
        taxa_servico_pct: round1(pctOf(cur.escrow.service_fee, gmvDetail)),
        taxa_transacao: round2(cur.escrow.seller_transaction_fee),
        taxa_cartao: round2(taxaCartao),
        fbs_fee: round2(cur.escrow.fbs_fee),
        processing_fee: round2(cur.escrow.processing_fee),
      },
      aquisicao: {
        total: round2(aquisicaoTotal),
        pct_gmv: round1(pctOf(aquisicaoTotal, gmv)),
        ads: round2(adsExpense),
        ads_roas: round2(adsRoas),
        ads_tacos: round1(adsTacos),
        afiliados: round2(afiliadosLiquido),
        afiliados_pct: round1(pctOf(afiliadosLiquido, gmv)),
      },
      friccao: {
        total: round2(friccaoTotal),
        pct_gmv: round1(pctOf(friccaoTotal, gmv)),
        devolucoes: {
          custo_total: round2(devolucoesCustoTotal),
          frete_reverso: round2(freteReverso),
          frete_ida_seller: round2(freteIdaSeller),
          total_wallet: round2(devolucoesTotalWallet),
          reversao_receita: round2(devolucoesReversaoReceita),
          qtd: Math.max(cur.wallet.devolucao_qtd, cur.escrow.reverse_shipping_fee_count),
        },
        difal: round2(difal),
        difal_qtd: cur.wallet.difal_qtd,
        // Informativo: custo real já contabilizado em devolucoes.custo_total.
        pedidos_negativos: round2(pedidosNegativos),
        pedidos_negativos_qtd: cur.wallet.pedidos_negativos_qtd,
        fbs_custos: round2(fbsCustosLiquido),
        outros: round2(outrosCustos),
      },
      total: round2(custoTotal),
      total_pct_gmv: round1(pctOf(custoTotal, gmv)),
    },

    margem: {
      valor: round2(margemValor),
      pct_gmv: round1(pctOf(margemValor, gmv)),
    },

    subsidio_shopee: {
      total: round2(subsidioTotal),
      desconto_shopee: round2(cur.escrow.shopee_discount),
      voucher_shopee: round2(cur.escrow.voucher_from_shopee),
      coins: round2(cur.escrow.coins),
      promo_cartao: round2(cur.escrow.credit_card_promotion),
      pix_discount: round2(cur.escrow.pix_discount),
      pct_gmv: round1(pctOf(subsidioTotal, gmv)),
    },

    compensacoes: {
      total: round2(cur.wallet.compensacoes_total),
      qtd: cur.wallet.compensacoes_qtd,
      detalhe: Array.from(cur.wallet.compensacoes_detail.values())
        .sort((a, b) => b.total - a.total)
        .map(g => ({
          description: g.description,
          count: g.count,
          total: round2(g.total),
        })),
    },

    informativo: {
      saques: round2(cur.wallet.saques_total),
      saques_qtd: cur.wallet.saques_qtd,
      saldo_carteira: round2(saldoWallet),
      cobertura_financeira: round1(cobertura),
      pedidos_sem_escrow: pedidosSemEscrow,
      receita_pendente: round2(receitaPendente),
      // Cobertura do detail no período: quantos escrows já têm campos finos
      // (commission, service_fee, etc.). Os percentuais (take rate, comissão %)
      // são calculados sobre esta amostra.
      detail_coverage: round1(detailCoverage),
      escrows_com_detail: countWithDetail,
      escrows_sem_detail: Math.max(0, cur.escrow.count - countWithDetail),
    },

    cupons_seller: {
      voucher_seller: round2(cur.escrow.voucher_from_seller),
      seller_discount: round2(cur.escrow.seller_discount),
    },

    outros_custos_detalhe: outrosDetalhe,

    receita_por_dia: receitaPorDia,

    distribuicao,

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
      reverse_shipping_fee: e.reverse_shipping_fee,
      order_ams_commission_fee: e.order_ams_commission_fee,
    })),
  });
}

function emptyPayload(
  from: Date,
  to: Date,
  label: string,
  shopFilter: string,
  allShops: Array<{ shop_id: number; shop_name: string | null }>,
) {
  return {
    period: {
      from: brDateString(from),
      to: brDateString(to),
      label,
    },
    shops: allShops.map(s => ({ shop_id: s.shop_id, name: s.shop_name })),
    shop_filter: shopFilter,
    receita: {
      gmv: 0, gmv_variacao: 0, receita_liquida: 0, receita_liquida_pct: 0,
      receita_liquida_variacao: 0, ticket_medio: 0, preco_medio_efetivo: 0,
      total_pedidos: 0, total_pecas: 0,
    },
    take_rate: { percentual: 0, valor: 0 },
    custos: {
      plataforma: { total: 0, pct_gmv: 0, comissao: 0, comissao_pct: 0, taxa_servico: 0, taxa_servico_pct: 0, taxa_transacao: 0, taxa_cartao: 0, fbs_fee: 0, processing_fee: 0 },
      aquisicao: { total: 0, pct_gmv: 0, ads: 0, ads_roas: 0, ads_tacos: 0, afiliados: 0, afiliados_pct: 0 },
      friccao: {
        total: 0, pct_gmv: 0,
        devolucoes: {
          custo_total: 0, frete_reverso: 0, frete_ida_seller: 0,
          total_wallet: 0, reversao_receita: 0, qtd: 0,
        },
        difal: 0, difal_qtd: 0, pedidos_negativos: 0, pedidos_negativos_qtd: 0, fbs_custos: 0, outros: 0,
      },
      total: 0, total_pct_gmv: 0,
    },
    margem: { valor: 0, pct_gmv: 0 },
    subsidio_shopee: { total: 0, desconto_shopee: 0, voucher_shopee: 0, coins: 0, promo_cartao: 0, pix_discount: 0, pct_gmv: 0 },
    compensacoes: { total: 0, qtd: 0, detalhe: [] },
    informativo: { saques: 0, saques_qtd: 0, saldo_carteira: 0, cobertura_financeira: 0, pedidos_sem_escrow: 0, receita_pendente: 0, detail_coverage: 0, escrows_com_detail: 0, escrows_sem_detail: 0 },
    cupons_seller: { voucher_seller: 0, seller_discount: 0 },
    outros_custos_detalhe: [],
    receita_por_dia: [],
    distribuicao: { liquido_pct: 0, plataforma_pct: 0, ads_pct: 0, afiliados_pct: 0, difal_pct: 0, devolucoes_frete_pct: 0, outros_pct: 0 },
    conciliacao: Object.fromEntries(CONCILIACAO_KEYS.map(k => [k, 0])),
    ultimos_pedidos: [],
  };
}
