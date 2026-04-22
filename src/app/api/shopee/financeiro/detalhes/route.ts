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

type Tipo = 'take_rate' | 'afiliados' | 'devolucoes';

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

type Derived = DerivedTakeRate | DerivedAfiliados | DerivedDevolucoes;

// Campos válidos por tipo para o dropdown de ordenação. O front envia
// o nome; aqui mapeamos para getters tipados.
const SORT_FIELDS: Record<Tipo, string[]> = {
  take_rate:  ['take_rate_pct', 'total_taxas', 'buyer_total_amount', 'commission_fee', 'service_fee'],
  afiliados:  ['order_ams_commission_fee', 'afiliado_pct', 'order_selling_price'],
  devolucoes: ['custo_total_devolucao', 'reverse_shipping_fee', 'frete_ida_seller', 'seller_return_refund', 'escrow_amount'],
};

const DEFAULT_SORT: Record<Tipo, string> = {
  take_rate:  'take_rate_pct',
  afiliados:  'order_ams_commission_fee',
  devolucoes: 'custo_total_devolucao',
};

type SupabaseClient = ReturnType<typeof createServiceClient>;

// Busca paginada de escrows com filtros específicos por tipo. Retorna
// o array completo (dentro do período) para permitir ordenação e
// agregação em memória.
async function fetchEscrows(
  supabase: SupabaseClient,
  tipo: Tipo,
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
  }
}

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;

    const tipoStr = sp.get('tipo') ?? '';
    if (tipoStr !== 'take_rate' && tipoStr !== 'afiliados' && tipoStr !== 'devolucoes') {
      return NextResponse.json({ error: 'tipo inválido' }, { status: 400 });
    }
    const tipo: Tipo = tipoStr;

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

    const rows = await fetchEscrows(
      supabase, tipo, shopIds,
      fromDate.toISOString(), toDate.toISOString(),
    );

    // Deriva linhas.
    let derived: Derived[];
    let resumo: Record<string, unknown>;

    if (tipo === 'take_rate') {
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
      const list = rows.map(deriveAfiliados);
      derived = list;
      // Conta pedidos SEM afiliado no mesmo período (or: null + eq 0).
      const { count: semCount } = await supabase
        .from('shopee_escrow')
        .select('*', { count: 'exact', head: true })
        .in('shop_id', shopIds)
        .eq('is_released', true)
        .not('escrow_release_time', 'is', null)
        .gte('escrow_release_time', fromDate.toISOString())
        .lte('escrow_release_time', toDate.toISOString())
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
    } else {
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
    }

    // Filtro por busca (order_sn). Não afeta o resumo — o usuário quer
    // ver o total do período, e a busca é só para localizar 1 pedido.
    let filtrado: Derived[] = derived;
    if (busca) {
      filtrado = filtrado.filter(r => r.order_sn.toLowerCase().includes(busca));
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
