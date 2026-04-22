import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Detalhes por pedido para os modais clicáveis do dashboard financeiro.
// Tipos: take_rate, afiliados, devolucoes. Todos leem de shopee_escrow
// com filtro por escrow_release_time em BRT — idêntico ao cálculo do
// /api/shopee/financeiro, para garantir que o total visto no card bate
// com a lista do modal.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const PAGE_DB = 1000;                // limite PostgREST
const MAX_LIMIT_PAGE = 200;          // por segurança
const BR_OFFSET_HOURS = 3;

type Tipo =
  | 'take_rate' | 'afiliados' | 'devolucoes'
  | 'difal' | 'fbs' | 'subsidio'
  | 'cupons_seller' | 'compensacoes' | 'pedidos_negativos';

// Transaction types da wallet que representam cada custo. Se a Shopee
// criar variantes novas, adicionar aqui e no mapping SQL.
const DIFAL_TX_TYPES = ['ADJUSTMENT_CENTER_DEDUCT'];
const FBS_TX_TYPES = ['FBS_FEE_CHARGE_MINUS', 'FBS_ADJUSTMENT_MINUS'];

// Regex extraindo o order_sn na description das cobranças de DIFAL.
// Formato visto em produção: "... referente ao pedido 260414QA1CJ7K5".
const ORDER_SN_IN_DESCRIPTION = /referente ao pedido\s+(\S+)\s*$/i;
function extractOrderSnFromDescription(description: string | null): string | null {
  if (!description) return null;
  const m = description.match(ORDER_SN_IN_DESCRIPTION);
  return m?.[1] ?? null;
}

function startOfBrDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, BR_OFFSET_HOURS, 0, 0, 0));
}
function endOfBrDate(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day + 1, BR_OFFSET_HOURS - 1, 59, 59, 999));
}

function parseBrDateTriple(s: string): [number, number, number] | null {
  const parts = s.split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2]];
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

interface EscrowRow {
  order_sn: string;
  buyer_total_amount: number | null;
  order_selling_price: number | null;
  commission_fee: number | null;
  service_fee: number | null;
  actual_shipping_fee: number | null;
  shopee_shipping_rebate: number | null;
  reverse_shipping_fee: number | null;
  seller_return_refund: number | null;
  order_ams_commission_fee: number | null;
  buyer_payment_method: string | null;
  escrow_amount: number | null;
  escrow_release_time: string | null;
}

const SELECT_COLS =
  'order_sn, buyer_total_amount, order_selling_price, commission_fee, service_fee, actual_shipping_fee, shopee_shipping_rebate, reverse_shipping_fee, seller_return_refund, order_ams_commission_fee, buyer_payment_method, escrow_amount, escrow_release_time';

interface DerivedTakeRate {
  kind: 'take_rate';
  order_sn: string;
  buyer_total_amount: number;
  order_selling_price: number;
  commission_fee: number;
  service_fee: number;
  total_taxas: number;
  take_rate_pct: number;
  payment_method: string | null;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface DerivedAfiliados {
  kind: 'afiliados';
  order_sn: string;
  order_selling_price: number;
  order_ams_commission_fee: number;
  afiliado_pct: number;
  commission_fee: number;
  service_fee: number;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface DerivedDevolucoes {
  kind: 'devolucoes';
  order_sn: string;
  order_selling_price: number;
  reverse_shipping_fee: number;
  actual_shipping_fee: number;
  shopee_shipping_rebate: number;
  frete_ida_seller: number;
  custo_total_devolucao: number;
  seller_return_refund: number;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface EscrowSubsidioRow {
  order_sn: string;
  order_selling_price: number | null;
  coins: number | null;
  voucher_from_shopee: number | null;
  shopee_discount: number | null;
  credit_card_promotion: number | null;
  pix_discount: number | null;
  escrow_release_time: string | null;
}

interface WalletRow {
  id: number;
  transaction_type: string | null;
  order_sn: string | null;
  amount: number | null;
  description: string | null;
  create_time: string | null;
}

interface EscrowCuponsRow {
  order_sn: string;
  order_selling_price: number | null;
  voucher_from_seller: number | null;
  escrow_amount: number | null;
  escrow_release_time: string | null;
  raw_json: unknown;
}

interface EscrowNegativoRow {
  order_sn: string;
  buyer_total_amount: number | null;
  order_selling_price: number | null;
  escrow_amount: number | null;
  commission_fee: number | null;
  service_fee: number | null;
  reverse_shipping_fee: number | null;
  actual_shipping_fee: number | null;
  shopee_shipping_rebate: number | null;
  seller_return_refund: number | null;
  escrow_release_time: string | null;
}

interface DerivedDifal {
  kind: 'difal';
  id: number;
  order_sn_extraido: string | null;
  description: string;
  amount: number;
  create_time: string | null;
  shipping_carrier: string | null;
}

interface DerivedFbs {
  kind: 'fbs';
  id: number;
  transaction_type: string;
  description: string;
  amount: number;
  create_time: string | null;
}

interface DerivedSubsidio {
  kind: 'subsidio';
  order_sn: string;
  order_selling_price: number;
  coins: number;
  voucher_from_shopee: number;
  shopee_discount: number;
  credit_card_promotion: number;
  pix_discount: number;
  total_subsidio: number;
  subsidio_pct: number;
  escrow_release_time: string | null;
}

interface DerivedCupons {
  kind: 'cupons_seller';
  order_sn: string;
  order_selling_price: number;
  voucher_from_seller: number;
  cupom_pct: number;
  cupom_codigo: string | null;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface DerivedCompensacao {
  kind: 'compensacoes';
  id: number;
  transaction_type: string;
  order_sn: string | null;
  description: string;
  amount: number;
  create_time: string | null;
  tipo_compensacao: 'Objeto perdido' | 'Devolução compensada' | 'Outro';
}

interface DerivedPedidoNegativo {
  kind: 'pedidos_negativos';
  order_sn: string;
  buyer_total_amount: number;
  order_selling_price: number;
  escrow_amount: number;
  commission_fee: number;
  service_fee: number;
  reverse_shipping_fee: number;
  actual_shipping_fee: number;
  shopee_shipping_rebate: number;
  seller_return_refund: number;
  prejuizo: number;
  escrow_release_time: string | null;
}

type Derived =
  | DerivedTakeRate
  | DerivedAfiliados
  | DerivedDevolucoes
  | DerivedDifal
  | DerivedFbs
  | DerivedSubsidio
  | DerivedCupons
  | DerivedCompensacao
  | DerivedPedidoNegativo;

// Campos válidos por tipo para o dropdown de ordenação. O front envia
// o nome; aqui mapeamos para getters tipados.
const SORT_FIELDS: Record<Tipo, string[]> = {
  take_rate:  ['take_rate_pct', 'total_taxas', 'buyer_total_amount', 'commission_fee', 'service_fee'],
  afiliados:  ['order_ams_commission_fee', 'afiliado_pct', 'order_selling_price'],
  devolucoes: ['custo_total_devolucao', 'reverse_shipping_fee', 'frete_ida_seller', 'seller_return_refund', 'escrow_amount'],
  difal:      ['amount', 'create_time'],
  fbs:        ['amount', 'create_time'],
  subsidio:   ['total_subsidio', 'subsidio_pct', 'coins', 'voucher_from_shopee', 'pix_discount'],
  cupons_seller:     ['voucher_from_seller', 'cupom_pct', 'order_selling_price'],
  compensacoes:      ['amount', 'create_time'],
  pedidos_negativos: ['escrow_amount', 'prejuizo', 'buyer_total_amount', 'reverse_shipping_fee'],
};

const DEFAULT_SORT: Record<Tipo, string> = {
  take_rate:  'take_rate_pct',
  afiliados:  'order_ams_commission_fee',
  devolucoes: 'custo_total_devolucao',
  difal:      'amount',
  fbs:        'amount',
  subsidio:   'total_subsidio',
  // pedidos_negativos: prejuizo DESC = maior prejuízo primeiro (intuitivo).
  // Ordenar por escrow_amount direto exigiria direção ASC para o mesmo
  // resultado, o que quebra o padrão "desc = maiores primeiro" do UI.
  cupons_seller:     'voucher_from_seller',
  compensacoes:      'amount',
  pedidos_negativos: 'prejuizo',
};

type SupabaseClient = ReturnType<typeof createServiceClient>;

// Busca paginada de escrows com filtros específicos por tipo. Retorna
// o array completo (dentro do período) para permitir ordenação e
// agregação em memória.
async function fetchEscrows(
  supabase: SupabaseClient,
  tipo: 'take_rate' | 'afiliados' | 'devolucoes',
  shopIds: number[],
  fromIso: string,
  toIso: string,
): Promise<EscrowRow[]> {
  const rows: EscrowRow[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('shopee_escrow')
      .select(SELECT_COLS)
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .gte('escrow_release_time', fromIso)
      .lte('escrow_release_time', toIso);

    if (tipo === 'take_rate') {
      q = q.not('buyer_total_amount', 'is', null).gt('buyer_total_amount', 0);
    } else if (tipo === 'afiliados') {
      q = q.gt('order_ams_commission_fee', 0);
    } else {
      q = q.gt('reverse_shipping_fee', 0);
    }

    const { data, error } = await q.range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as EscrowRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

// Busca escrows com algum tipo de subsídio Shopee > 0 no período.
// Paginação idêntica ao fetchEscrows. SELECT é menor (só os campos
// de subsídio) — subsidio não usa commission/service/etc.
async function fetchEscrowsSubsidio(
  supabase: SupabaseClient,
  shopIds: number[],
  fromIso: string,
  toIso: string,
): Promise<EscrowSubsidioRow[]> {
  const rows: EscrowSubsidioRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopee_escrow')
      .select('order_sn, order_selling_price, coins, voucher_from_shopee, shopee_discount, credit_card_promotion, pix_discount, escrow_release_time')
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .gte('escrow_release_time', fromIso)
      .lte('escrow_release_time', toIso)
      .or('coins.gt.0,voucher_from_shopee.gt.0,shopee_discount.gt.0,credit_card_promotion.gt.0,pix_discount.gt.0')
      .range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as EscrowSubsidioRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

async function fetchWallet(
  supabase: SupabaseClient,
  shopIds: number[],
  fromIso: string,
  toIso: string,
  txTypes: string[],
): Promise<WalletRow[]> {
  const rows: WalletRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopee_wallet')
      .select('id, transaction_type, order_sn, amount, description, create_time')
      .in('shop_id', shopIds)
      .in('transaction_type', txTypes)
      .gte('create_time', fromIso)
      .lte('create_time', toIso)
      .range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as WalletRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

// Compensações chegam em 3 formas na wallet; buscamos o superset e
// classificamos em memória (mesma regra do /api/shopee/financeiro):
//   - RETURN_COMPENSATION_SERVICE_ADD
//   - transaction_type vazio com description contendo "objeto perdido"
//     ou "reembolso"
//   - ADJUSTMENT_ADD com description contendo "compensation"/"perdido"/
//     "danificado"/"extraviado"
// Apenas créditos (amount > 0).
async function fetchCompensacoes(
  supabase: SupabaseClient,
  shopIds: number[],
  fromIso: string,
  toIso: string,
): Promise<WalletRow[]> {
  const rows: WalletRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopee_wallet')
      .select('id, transaction_type, order_sn, amount, description, create_time')
      .in('shop_id', shopIds)
      .in('transaction_type', ['RETURN_COMPENSATION_SERVICE_ADD', '', 'ADJUSTMENT_ADD'])
      .gt('amount', 0)
      .gte('create_time', fromIso)
      .lte('create_time', toIso)
      .range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as WalletRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

async function fetchEscrowsCupons(
  supabase: SupabaseClient,
  shopIds: number[],
  fromIso: string,
  toIso: string,
): Promise<EscrowCuponsRow[]> {
  const rows: EscrowCuponsRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopee_escrow')
      .select('order_sn, order_selling_price, voucher_from_seller, escrow_amount, escrow_release_time, raw_json')
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .gte('escrow_release_time', fromIso)
      .lte('escrow_release_time', toIso)
      .gt('voucher_from_seller', 0)
      .range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as EscrowCuponsRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

async function fetchEscrowsNegativos(
  supabase: SupabaseClient,
  shopIds: number[],
  fromIso: string,
  toIso: string,
): Promise<EscrowNegativoRow[]> {
  const rows: EscrowNegativoRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('shopee_escrow')
      .select('order_sn, buyer_total_amount, order_selling_price, escrow_amount, commission_fee, service_fee, reverse_shipping_fee, actual_shipping_fee, shopee_shipping_rebate, seller_return_refund, escrow_release_time')
      .in('shop_id', shopIds)
      .eq('is_released', true)
      .not('escrow_release_time', 'is', null)
      .gte('escrow_release_time', fromIso)
      .lte('escrow_release_time', toIso)
      .lt('escrow_amount', 0)
      .range(offset, offset + PAGE_DB - 1);
    if (error) throw new Error(error.message);
    const page = (data as EscrowNegativoRow[] | null) ?? [];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_DB) break;
    offset += PAGE_DB;
  }
  return rows;
}

// Extrai seller_voucher_code do raw_json do escrow. O Shopee entrega o
// campo como array de strings em order_income/order_item_list — como o
// schema varia entre versões, fazemos busca recursiva pela chave.
function extractSellerVoucherCode(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const visited = new Set<object>();
  const queue: unknown[] = [raw];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== 'object' || visited.has(cur as object)) continue;
    visited.add(cur as object);
    if (Array.isArray(cur)) {
      for (const item of cur) queue.push(item);
      continue;
    }
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (k === 'seller_voucher_code' && Array.isArray(v)) {
        const codes = v.filter((x): x is string => typeof x === 'string' && x.length > 0);
        if (codes.length > 0) return codes.join(', ');
      } else if (v && typeof v === 'object') {
        queue.push(v);
      }
    }
  }
  return null;
}

// Classifica uma linha da wallet como compensação. Retorna null se não
// for uma compensação válida; caso contrário, o tipo para a UI.
function classifyCompensacao(r: WalletRow): 'Objeto perdido' | 'Devolução compensada' | 'Outro' | null {
  const tt = r.transaction_type ?? '';
  const desc = (r.description ?? '').toLowerCase();
  const amount = num(r.amount);
  if (amount <= 0) return null;

  let keep = false;
  if (tt === 'RETURN_COMPENSATION_SERVICE_ADD') {
    keep = true;
  } else if (tt === '' && (desc.includes('objeto perdido') || desc.includes('reembolso'))) {
    keep = true;
  } else if (tt === 'ADJUSTMENT_ADD' && (
    desc.includes('compensation') || desc.includes('perdido') ||
    desc.includes('danificado') || desc.includes('extraviado')
  )) {
    keep = true;
  }
  if (!keep) return null;

  if (desc.includes('perdido')) return 'Objeto perdido';
  if (desc.includes('compensation') || desc.includes('return')) return 'Devolução compensada';
  return 'Outro';
}

function deriveTakeRate(r: EscrowRow): DerivedTakeRate {
  const buyer = num(r.buyer_total_amount);
  const osp = num(r.order_selling_price);
  const com = num(r.commission_fee);
  const svc = num(r.service_fee);
  const total = com + svc;
  // Denominador: order_selling_price quando > 0; fallback
  // buyer_total_amount mantém a % computável para pedidos antigos
  // sem detail completo.
  const denom = osp > 0 ? osp : buyer;
  return {
    kind: 'take_rate',
    order_sn: r.order_sn,
    buyer_total_amount: round2(buyer),
    order_selling_price: round2(osp),
    commission_fee: round2(com),
    service_fee: round2(svc),
    total_taxas: round2(total),
    take_rate_pct: round2(pctOf(total, denom)),
    payment_method: r.buyer_payment_method,
    escrow_amount: round2(num(r.escrow_amount)),
    escrow_release_time: r.escrow_release_time,
  };
}

function deriveAfiliados(r: EscrowRow): DerivedAfiliados {
  const osp = num(r.order_selling_price);
  const ams = num(r.order_ams_commission_fee);
  return {
    kind: 'afiliados',
    order_sn: r.order_sn,
    order_selling_price: round2(osp),
    order_ams_commission_fee: round2(ams),
    afiliado_pct: round2(pctOf(ams, osp)),
    commission_fee: round2(num(r.commission_fee)),
    service_fee: round2(num(r.service_fee)),
    escrow_amount: round2(num(r.escrow_amount)),
    escrow_release_time: r.escrow_release_time,
  };
}

function deriveDevolucoes(r: EscrowRow): DerivedDevolucoes {
  const rev = num(r.reverse_shipping_fee);
  const asf = num(r.actual_shipping_fee);
  const reb = num(r.shopee_shipping_rebate);
  // Frete ida só pesa quando a Shopee não ressarciu.
  const ida = reb === 0 && asf > 0 ? asf : 0;
  return {
    kind: 'devolucoes',
    order_sn: r.order_sn,
    order_selling_price: round2(num(r.order_selling_price)),
    reverse_shipping_fee: round2(rev),
    actual_shipping_fee: round2(asf),
    shopee_shipping_rebate: round2(reb),
    frete_ida_seller: round2(ida),
    custo_total_devolucao: round2(rev + ida),
    seller_return_refund: round2(num(r.seller_return_refund)),
    escrow_amount: round2(num(r.escrow_amount)),
    escrow_release_time: r.escrow_release_time,
  };
}

function deriveSubsidio(r: EscrowSubsidioRow): DerivedSubsidio {
  const osp = num(r.order_selling_price);
  const coins = num(r.coins);
  const vfs = num(r.voucher_from_shopee);
  const sd = num(r.shopee_discount);
  const ccp = num(r.credit_card_promotion);
  const pix = num(r.pix_discount);
  const total = coins + vfs + sd + ccp + pix;
  return {
    kind: 'subsidio',
    order_sn: r.order_sn,
    order_selling_price: round2(osp),
    coins: round2(coins),
    voucher_from_shopee: round2(vfs),
    shopee_discount: round2(sd),
    credit_card_promotion: round2(ccp),
    pix_discount: round2(pix),
    total_subsidio: round2(total),
    subsidio_pct: round2(pctOf(total, osp)),
    escrow_release_time: r.escrow_release_time,
  };
}

function deriveDifal(r: WalletRow, carriers: Map<string, string>): DerivedDifal {
  const desc = r.description ?? '';
  const osn = extractOrderSnFromDescription(desc);
  return {
    kind: 'difal',
    id: r.id,
    order_sn_extraido: osn,
    description: desc,
    amount: round2(Math.abs(num(r.amount))),
    create_time: r.create_time,
    shipping_carrier: osn ? carriers.get(osn) ?? null : null,
  };
}

function deriveFbs(r: WalletRow): DerivedFbs {
  return {
    kind: 'fbs',
    id: r.id,
    transaction_type: r.transaction_type ?? '',
    description: r.description ?? '',
    amount: round2(Math.abs(num(r.amount))),
    create_time: r.create_time,
  };
}

function deriveCupons(r: EscrowCuponsRow): DerivedCupons {
  const osp = num(r.order_selling_price);
  const vfs = num(r.voucher_from_seller);
  return {
    kind: 'cupons_seller',
    order_sn: r.order_sn,
    order_selling_price: round2(osp),
    voucher_from_seller: round2(vfs),
    cupom_pct: round2(pctOf(vfs, osp)),
    cupom_codigo: extractSellerVoucherCode(r.raw_json),
    escrow_amount: round2(num(r.escrow_amount)),
    escrow_release_time: r.escrow_release_time,
  };
}

function deriveCompensacao(r: WalletRow, tipo: 'Objeto perdido' | 'Devolução compensada' | 'Outro'): DerivedCompensacao {
  return {
    kind: 'compensacoes',
    id: r.id,
    transaction_type: r.transaction_type ?? '',
    order_sn: r.order_sn,
    description: r.description ?? '',
    amount: round2(num(r.amount)),
    create_time: r.create_time,
    tipo_compensacao: tipo,
  };
}

function derivePedidoNegativo(r: EscrowNegativoRow): DerivedPedidoNegativo {
  const esc = num(r.escrow_amount);
  return {
    kind: 'pedidos_negativos',
    order_sn: r.order_sn,
    buyer_total_amount: round2(num(r.buyer_total_amount)),
    order_selling_price: round2(num(r.order_selling_price)),
    escrow_amount: round2(esc),
    commission_fee: round2(num(r.commission_fee)),
    service_fee: round2(num(r.service_fee)),
    reverse_shipping_fee: round2(num(r.reverse_shipping_fee)),
    actual_shipping_fee: round2(num(r.actual_shipping_fee)),
    shopee_shipping_rebate: round2(num(r.shopee_shipping_rebate)),
    seller_return_refund: round2(num(r.seller_return_refund)),
    prejuizo: round2(Math.abs(esc)),
    escrow_release_time: r.escrow_release_time,
  };
}

function sortKey(d: Derived, field: string): number {
  switch (d.kind) {
    case 'take_rate':
      if (field === 'take_rate_pct')      return d.take_rate_pct;
      if (field === 'total_taxas')        return d.total_taxas;
      if (field === 'buyer_total_amount') return d.buyer_total_amount;
      if (field === 'commission_fee')     return d.commission_fee;
      if (field === 'service_fee')        return d.service_fee;
      return d.take_rate_pct;
    case 'afiliados':
      if (field === 'order_ams_commission_fee') return d.order_ams_commission_fee;
      if (field === 'afiliado_pct')             return d.afiliado_pct;
      if (field === 'order_selling_price')      return d.order_selling_price;
      return d.order_ams_commission_fee;
    case 'devolucoes':
      if (field === 'custo_total_devolucao') return d.custo_total_devolucao;
      if (field === 'reverse_shipping_fee')  return d.reverse_shipping_fee;
      if (field === 'frete_ida_seller')      return d.frete_ida_seller;
      if (field === 'seller_return_refund')  return d.seller_return_refund;
      if (field === 'escrow_amount')         return d.escrow_amount;
      return d.custo_total_devolucao;
    case 'difal':
    case 'fbs':
      if (field === 'create_time') return d.create_time ? new Date(d.create_time).getTime() : 0;
      return d.amount;
    case 'subsidio':
      if (field === 'total_subsidio')      return d.total_subsidio;
      if (field === 'subsidio_pct')        return d.subsidio_pct;
      if (field === 'coins')               return d.coins;
      if (field === 'voucher_from_shopee') return d.voucher_from_shopee;
      if (field === 'pix_discount')        return d.pix_discount;
      return d.total_subsidio;
    case 'cupons_seller':
      if (field === 'voucher_from_seller') return d.voucher_from_seller;
      if (field === 'cupom_pct')           return d.cupom_pct;
      if (field === 'order_selling_price') return d.order_selling_price;
      return d.voucher_from_seller;
    case 'compensacoes':
      if (field === 'create_time') return d.create_time ? new Date(d.create_time).getTime() : 0;
      return d.amount;
    case 'pedidos_negativos':
      if (field === 'escrow_amount')        return d.escrow_amount;
      if (field === 'prejuizo')             return d.prejuizo;
      if (field === 'buyer_total_amount')   return d.buyer_total_amount;
      if (field === 'reverse_shipping_fee') return d.reverse_shipping_fee;
      return d.prejuizo;
  }
}

// Campo usado no filtro de busca — varia por tipo porque alguns não
// têm order_sn na raiz (difal o extrai da description, fbs não tem).
function searchText(d: Derived): string {
  if (d.kind === 'difal') return `${d.order_sn_extraido ?? ''} ${d.description}`.toLowerCase();
  if (d.kind === 'fbs')   return d.description.toLowerCase();
  if (d.kind === 'cupons_seller') {
    return `${d.order_sn} ${d.cupom_codigo ?? ''}`.toLowerCase();
  }
  if (d.kind === 'compensacoes') {
    return `${d.order_sn ?? ''} ${d.description}`.toLowerCase();
  }
  return d.order_sn.toLowerCase();
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    const tipoStr = sp.get('tipo') ?? '';
    const TIPOS_VALIDOS: Tipo[] = [
      'take_rate', 'afiliados', 'devolucoes',
      'difal', 'fbs', 'subsidio',
      'cupons_seller', 'compensacoes', 'pedidos_negativos',
    ];
    if (!(TIPOS_VALIDOS as string[]).includes(tipoStr)) {
      return NextResponse.json({ error: 'tipo inválido' }, { status: 400 });
    }
    const tipo: Tipo = tipoStr as Tipo;

    const fromStr = sp.get('from');
    const toStr = sp.get('to');
    if (!fromStr || !toStr) {
      return NextResponse.json({ error: 'from/to obrigatórios' }, { status: 400 });
    }
    const f = parseBrDateTriple(fromStr);
    const t = parseBrDateTriple(toStr);
    if (!f || !t) {
      return NextResponse.json({ error: 'from/to inválidos (use YYYY-MM-DD)' }, { status: 400 });
    }
    const fromDate = startOfBrDate(f[0], f[1] - 1, f[2]);
    const toDate = endOfBrDate(t[0], t[1] - 1, t[2]);
    if (toDate < fromDate) {
      return NextResponse.json({ error: 'to anterior a from' }, { status: 400 });
    }

    const shopIdStr = sp.get('shop_id') ?? 'all';
    const busca = (sp.get('busca') ?? '').trim().toLowerCase();
    const ordemRaw = sp.get('ordem') ?? '';
    const ordem = SORT_FIELDS[tipo].includes(ordemRaw) ? ordemRaw : DEFAULT_SORT[tipo];
    const direcao = (sp.get('direcao') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const limit = Math.min(MAX_LIMIT_PAGE, Math.max(1, Number(sp.get('limit') ?? '50') || 50));

    const supabase = createServiceClient();

    // Resolve lojas ativas → shopIds.
    let shopIds: number[];
    if (shopIdStr === 'all') {
      const { data } = await supabase
        .from('shopee_tokens')
        .select('shop_id')
        .eq('is_active', true);
      shopIds = ((data as Array<{ shop_id: number }> | null) ?? []).map(s => s.shop_id);
    } else {
      const n = Number(shopIdStr);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
      }
      shopIds = [n];
    }

    if (shopIds.length === 0) {
      return NextResponse.json({
        tipo,
        resumo: {},
        pedidos: [],
        pagination: { page: 1, limit, total: 0, total_pages: 0 },
      });
    }

    // Deriva linhas. Cada ramo faz seu próprio fetch (origens diferem
    // entre escrow e wallet).
    let derived: Derived[];
    let resumo: Record<string, unknown>;

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    if (tipo === 'take_rate') {
      const rows = await fetchEscrows(supabase, tipo, shopIds, fromIso, toIso);
      const list = rows.map(deriveTakeRate);
      derived = list;
      const totalCom = list.reduce((s, r) => s + r.commission_fee, 0);
      const totalSvc = list.reduce((s, r) => s + r.service_fee, 0);
      // Média do take_rate_pct só considera linhas com denominador > 0
      // (senão zero-items mascaram o valor real).
      const comDen = list.filter(r => r.take_rate_pct > 0);
      const mediaTakeRate = comDen.length > 0
        ? comDen.reduce((s, r) => s + r.take_rate_pct, 0) / comDen.length
        : 0;
      // GROUP BY método de pagamento.
      const porMetodo = new Map<string, { count: number; soma: number }>();
      for (const r of list) {
        const key = r.payment_method ?? '(desconhecido)';
        const g = porMetodo.get(key) ?? { count: 0, soma: 0 };
        g.count++;
        if (r.take_rate_pct > 0) g.soma += r.take_rate_pct;
        porMetodo.set(key, g);
      }
      const porMetodoArr = Array.from(porMetodo.entries())
        .map(([metodo, g]) => ({
          metodo,
          count: g.count,
          media_take_rate_pct: g.count > 0 ? round2(g.soma / g.count) : 0,
        }))
        .sort((a, b) => b.count - a.count);
      resumo = {
        total_pedidos: list.length,
        media_take_rate: round2(mediaTakeRate),
        total_comissao: round2(totalCom),
        total_taxa_servico: round2(totalSvc),
        por_metodo_pagamento: porMetodoArr,
      };
    } else if (tipo === 'afiliados') {
      const rows = await fetchEscrows(supabase, tipo, shopIds, fromIso, toIso);
      const list = rows.map(deriveAfiliados);
      derived = list;
      // Conta pedidos SEM afiliado no mesmo período (or: null + eq 0).
      const { count: semCount } = await supabase
        .from('shopee_escrow')
        .select('*', { count: 'exact', head: true })
        .in('shop_id', shopIds)
        .eq('is_released', true)
        .not('escrow_release_time', 'is', null)
        .gte('escrow_release_time', fromIso)
        .lte('escrow_release_time', toIso)
        .or('order_ams_commission_fee.is.null,order_ams_commission_fee.eq.0');
      const comCount = list.length;
      const semAfiliado = semCount ?? 0;
      const totalGasto = list.reduce((s, r) => s + r.order_ams_commission_fee, 0);
      resumo = {
        total_pedidos_com_afiliado: comCount,
        total_pedidos_sem_afiliado: semAfiliado,
        pct_pedidos_afiliado: round1(pctOf(comCount, comCount + semAfiliado)),
        total_gasto_afiliados: round2(totalGasto),
        media_comissao_afiliado: comCount > 0 ? round2(totalGasto / comCount) : 0,
      };
    } else if (tipo === 'devolucoes') {
      const rows = await fetchEscrows(supabase, tipo, shopIds, fromIso, toIso);
      const list = rows.map(deriveDevolucoes);
      derived = list;
      const totalReverso = list.reduce((s, r) => s + r.reverse_shipping_fee, 0);
      const totalIda = list.reduce((s, r) => s + r.frete_ida_seller, 0);
      const totalReemb = list.reduce((s, r) => s + Math.abs(r.seller_return_refund), 0);
      const negativos = list.filter(r => r.escrow_amount < 0).length;
      resumo = {
        total_devolucoes: list.length,
        total_frete_reverso: round2(totalReverso),
        total_frete_ida_seller: round2(totalIda),
        custo_total: round2(totalReverso + totalIda),
        total_reembolsado: round2(totalReemb),
        pedidos_negativos: negativos,
      };
    } else if (tipo === 'difal') {
      const rows = await fetchWallet(supabase, shopIds, fromIso, toIso, DIFAL_TX_TYPES);
      // Cruza com shopee_pedidos para trazer shipping_carrier (opcional —
      // se falhar por qualquer motivo, segue sem).
      const osns = Array.from(
        new Set(rows.map(r => extractOrderSnFromDescription(r.description)).filter((x): x is string => !!x)),
      );
      const carriers = new Map<string, string>();
      if (osns.length > 0) {
        try {
          const { data } = await supabase
            .from('shopee_pedidos')
            .select('order_sn, shipping_carrier')
            .in('shop_id', shopIds)
            .in('order_sn', osns);
          for (const p of (data as Array<{ order_sn: string; shipping_carrier: string | null }> | null) ?? []) {
            if (p.shipping_carrier) carriers.set(p.order_sn, p.shipping_carrier);
          }
        } catch {
          // ignorar — shipping_carrier é informativo.
        }
      }
      const list = rows.map(r => deriveDifal(r, carriers));
      derived = list;
      const totalValor = list.reduce((s, r) => s + r.amount, 0);
      resumo = {
        total_cobrancas: list.length,
        total_valor: round2(totalValor),
        media_por_cobranca: list.length > 0 ? round2(totalValor / list.length) : 0,
      };
    } else if (tipo === 'fbs') {
      const rows = await fetchWallet(supabase, shopIds, fromIso, toIso, FBS_TX_TYPES);
      const list = rows.map(deriveFbs);
      derived = list;
      const totalValor = list.reduce((s, r) => s + r.amount, 0);
      resumo = {
        total_cobrancas: list.length,
        total_valor: round2(totalValor),
        media_por_cobranca: list.length > 0 ? round2(totalValor / list.length) : 0,
      };
    } else if (tipo === 'subsidio') {
      const rows = await fetchEscrowsSubsidio(supabase, shopIds, fromIso, toIso);
      const list = rows.map(deriveSubsidio);
      derived = list;
      resumo = {
        total_pedidos_com_subsidio: list.length,
        total_subsidio: round2(list.reduce((s, r) => s + r.total_subsidio, 0)),
        total_coins: round2(list.reduce((s, r) => s + r.coins, 0)),
        total_voucher_shopee: round2(list.reduce((s, r) => s + r.voucher_from_shopee, 0)),
        total_pix_discount: round2(list.reduce((s, r) => s + r.pix_discount, 0)),
        total_shopee_discount: round2(list.reduce((s, r) => s + r.shopee_discount, 0)),
        total_credit_card_promo: round2(list.reduce((s, r) => s + r.credit_card_promotion, 0)),
      };
    } else if (tipo === 'cupons_seller') {
      const rows = await fetchEscrowsCupons(supabase, shopIds, fromIso, toIso);
      const list = rows.map(deriveCupons);
      derived = list;
      const totalGasto = list.reduce((s, r) => s + r.voucher_from_seller, 0);
      const comPct = list.filter(r => r.cupom_pct > 0);
      const cupomPctMedio = comPct.length > 0
        ? comPct.reduce((s, r) => s + r.cupom_pct, 0) / comPct.length
        : 0;
      // GROUP BY cupom_codigo — só inclui pedidos com código extraído.
      const porCodigo = new Map<string, { count: number; total: number }>();
      for (const r of list) {
        if (!r.cupom_codigo) continue;
        const g = porCodigo.get(r.cupom_codigo) ?? { count: 0, total: 0 };
        g.count++;
        g.total += r.voucher_from_seller;
        porCodigo.set(r.cupom_codigo, g);
      }
      const porCodigoArr = Array.from(porCodigo.entries())
        .map(([codigo, g]) => ({ codigo, count: g.count, total: round2(g.total) }))
        .sort((a, b) => b.total - a.total);
      resumo = {
        total_pedidos_com_cupom: list.length,
        total_gasto_cupons: round2(totalGasto),
        media_por_cupom: list.length > 0 ? round2(totalGasto / list.length) : 0,
        cupom_pct_medio: round2(cupomPctMedio),
        por_codigo_cupom: porCodigoArr.length > 0 ? porCodigoArr : undefined,
      };
    } else if (tipo === 'compensacoes') {
      const rows = await fetchCompensacoes(supabase, shopIds, fromIso, toIso);
      const list: DerivedCompensacao[] = [];
      for (const r of rows) {
        const tipoCp = classifyCompensacao(r);
        if (tipoCp) list.push(deriveCompensacao(r, tipoCp));
      }
      derived = list;
      const sumByTipo = (t: string) =>
        list.filter(r => r.tipo_compensacao === t).reduce((s, r) => s + r.amount, 0);
      resumo = {
        total_compensacoes: list.length,
        total_valor: round2(list.reduce((s, r) => s + r.amount, 0)),
        total_objetos_perdidos: round2(sumByTipo('Objeto perdido')),
        total_devolucoes_compensadas: round2(sumByTipo('Devolução compensada')),
        total_outros: round2(sumByTipo('Outro')),
      };
    } else {
      // pedidos_negativos
      const rows = await fetchEscrowsNegativos(supabase, shopIds, fromIso, toIso);
      const list = rows.map(derivePedidoNegativo);
      derived = list;
      const prejuizos = list.map(r => r.prejuizo);
      const totalPrej = prejuizos.reduce((s, v) => s + v, 0);
      resumo = {
        total_pedidos_negativos: list.length,
        total_prejuizo: round2(totalPrej),
        media_prejuizo: list.length > 0 ? round2(totalPrej / list.length) : 0,
        maior_prejuizo: prejuizos.length > 0 ? round2(Math.max(...prejuizos)) : 0,
        total_frete_reverso: round2(list.reduce((s, r) => s + r.reverse_shipping_fee, 0)),
        total_reembolsos: round2(list.reduce((s, r) => s + Math.abs(r.seller_return_refund), 0)),
      };
    }

    // Filtro por busca. Não afeta o resumo — o usuário quer ver o total
    // do período, e a busca é só para localizar 1 pedido.
    let filtrado: Derived[] = derived;
    if (busca) {
      filtrado = filtrado.filter(r => searchText(r).includes(busca));
    }

    // Ordenação.
    const dir = direcao === 'asc' ? 1 : -1;
    filtrado = [...filtrado].sort((a, b) => (sortKey(a, ordem) - sortKey(b, ordem)) * dir);

    // Paginação.
    const total = filtrado.length;
    const total_pages = Math.max(1, Math.ceil(total / limit));
    const pageClamp = Math.min(page, total_pages);
    const start = (pageClamp - 1) * limit;
    const pedidos = filtrado.slice(start, start + limit);

    return NextResponse.json({
      tipo,
      resumo,
      pedidos,
      pagination: {
        page: pageClamp,
        limit,
        total,
        total_pages,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
