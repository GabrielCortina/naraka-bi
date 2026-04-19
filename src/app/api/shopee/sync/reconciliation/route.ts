import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getActiveShops, type ActiveShop } from '@/lib/shopee/sync-helpers';

// Reconciliação Tiny × Shopee por pedido. Classifica cada pedido em um dos
// 14 estados (SHOPEE_API_REFERENCE.md §7) e UPSERTA em shopee_conciliacao.
// Toda mudança de classificação gera uma linha em shopee_conciliacao_log.
//
// Estratégia: iterar shopee_pedidos (cada um com shop_id conhecido) nas
// últimas 60 dias e LEFT JOIN com Tiny por order_sn. Pedidos do Tiny sem
// contraparte na Shopee (SEM_VINCULO_FINANCEIRO) requerem shop_id inferido
// — TODO, deixado fora do MVP.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const JOB_NAME = 'run_reconciliation';
const LOOKBACK_DAYS = 60;
const SLA_DAYS = 15;
const DIVERGENCE_TOLERANCE_PCT = 1.0;

interface ShopeePedidoRow {
  shop_id: number;
  order_sn: string;
  order_status: string | null;
  complete_time: string | null;
  update_time: string | null;
}

interface ShopeeEscrowRow {
  order_sn: string;
  buyer_total_amount: number | null;
  escrow_amount: number | null;
  commission_fee: number | null;
  service_fee: number | null;
  actual_shipping_fee: number | null;
  shopee_shipping_rebate: number | null;
  seller_return_refund: number | null;
  escrow_release_time: string | null;
  payout_amount: number | null;
  is_released: boolean | null;
}

interface ShopeeReturnRow {
  order_sn: string;
  status: string | null;
  refund_amount: number | null;
  update_time: string | null;
}

interface TinyPedidoRow {
  id: number;
  numero_pedido: string;
  numero_pedido_ecommerce: string;
  situacao: number;
  data_entrega: string | null;
  valor_total_pedido: number;
}

interface Classification {
  classificacao: string;
  severidade: 'success' | 'info' | 'warning' | 'critical';
}

function classify(
  p: ShopeePedidoRow,
  escrow: ShopeeEscrowRow | null,
  returns: ShopeeReturnRow[],
  tiny: TinyPedidoRow | null,
): Classification {
  if (!tiny) {
    return { classificacao: 'ORFAO_SHOPEE', severidade: 'critical' };
  }

  const status = p.order_status;

  if (status === 'CANCELLED' || status === 'IN_CANCEL') {
    return { classificacao: 'CANCELADO', severidade: 'info' };
  }

  const dispute = returns.find(r => r.status === 'JUDGING' || r.status === 'IN_DISPUTE');
  if (dispute) return { classificacao: 'EM_DISPUTA', severidade: 'warning' };

  const activeReturn = returns.find(r =>
    ['ACCEPTED', 'PROCESSING', 'CLOSED', 'REFUND_PAID'].includes(r.status ?? ''),
  );
  if (activeReturn) {
    const refund = activeReturn.refund_amount ?? 0;
    const escrowAmt = escrow?.escrow_amount ?? 0;
    if (refund > 0 && escrowAmt > 0 && refund < escrowAmt) {
      return { classificacao: 'REEMBOLSADO_PARCIAL', severidade: 'warning' };
    }
    return { classificacao: 'DEVOLVIDO', severidade: 'warning' };
  }

  if (status === 'UNPAID' || status === 'READY_TO_SHIP') {
    return { classificacao: 'AGUARDANDO_ENVIO', severidade: 'info' };
  }
  if (status === 'SHIPPED' || status === 'PROCESSED') {
    return { classificacao: 'EM_TRANSITO', severidade: 'info' };
  }
  if (status === 'TO_CONFIRM_RECEIVE') {
    return { classificacao: 'ENTREGUE_AGUARDANDO_CONFIRMACAO', severidade: 'info' };
  }

  if (status === 'COMPLETED') {
    if (escrow?.is_released) {
      const tinyValor = tiny.valor_total_pedido ?? 0;
      const shopeeValor = escrow.buyer_total_amount ?? 0;
      if (shopeeValor > 0) {
        const diff = Math.abs(tinyValor - shopeeValor);
        const pct = (diff / shopeeValor) * 100;
        if (pct <= DIVERGENCE_TOLERANCE_PCT) {
          return { classificacao: 'PAGO_OK', severidade: 'success' };
        }
        return { classificacao: 'PAGO_COM_DIVERGENCIA', severidade: 'warning' };
      }
      return { classificacao: 'PAGO_OK', severidade: 'success' };
    }

    if (!p.complete_time) {
      return { classificacao: 'DADOS_INSUFICIENTES', severidade: 'info' };
    }
    const daysSince = (Date.now() - new Date(p.complete_time).getTime()) / 86400000;
    if (daysSince <= SLA_DAYS) {
      return { classificacao: 'AGUARDANDO_LIBERACAO', severidade: 'info' };
    }
    return { classificacao: 'ATRASO_DE_REPASSE', severidade: 'critical' };
  }

  return { classificacao: 'DADOS_INSUFICIENTES', severidade: 'info' };
}

function buildRow(
  shopId: number,
  p: ShopeePedidoRow,
  escrow: ShopeeEscrowRow | null,
  returns: ShopeeReturnRow[],
  tiny: TinyPedidoRow | null,
  cls: Classification,
  now: string,
) {
  const valorBrutoShopee = escrow?.buyer_total_amount ?? null;
  const valorLiquidoShopee = escrow?.escrow_amount ?? null;
  const valorBrutoTiny = tiny?.valor_total_pedido ?? null;

  let divergenciaValor: number | null = null;
  let divergenciaPercentual: number | null = null;
  if (valorBrutoTiny != null && valorBrutoShopee != null && valorBrutoShopee > 0) {
    divergenciaValor = Math.round((valorBrutoTiny - valorBrutoShopee) * 100) / 100;
    divergenciaPercentual =
      Math.round((divergenciaValor / valorBrutoShopee) * 10000) / 100;
  }

  const valorFreteLiquido =
    escrow?.actual_shipping_fee != null
      ? Math.round(
          ((escrow.actual_shipping_fee ?? 0) - (escrow.shopee_shipping_rebate ?? 0)) * 100,
        ) / 100
      : null;

  const ret = returns[0] ?? null;

  let diasParaPagamento: number | null = null;
  if (p.complete_time && escrow?.escrow_release_time) {
    const diffMs =
      new Date(escrow.escrow_release_time).getTime() - new Date(p.complete_time).getTime();
    diasParaPagamento = Math.max(0, Math.round(diffMs / 86400000));
  }

  return {
    shop_id: shopId,
    order_sn: p.order_sn,
    tiny_pedido_id: tiny?.id ?? null,
    tiny_numero_pedido: tiny?.numero_pedido ?? null,

    status_tiny: tiny ? String(tiny.situacao) : null,
    data_entrega_tiny: tiny?.data_entrega ?? null,

    status_shopee: p.order_status,
    data_completed_shopee: p.complete_time,

    valor_bruto_shopee: valorBrutoShopee,
    valor_liquido_shopee: valorLiquidoShopee,
    valor_comissao: escrow?.commission_fee ?? null,
    valor_taxa_servico: escrow?.service_fee ?? null,
    valor_frete_liquido: valorFreteLiquido,
    valor_reembolso: ret?.refund_amount ?? escrow?.seller_return_refund ?? null,

    valor_bruto_tiny: valorBrutoTiny,
    divergencia_valor: divergenciaValor,
    divergencia_percentual: divergenciaPercentual,

    data_escrow_release: escrow?.escrow_release_time ?? null,
    valor_pago: escrow?.payout_amount ?? escrow?.escrow_amount ?? null,
    dias_para_pagamento: diasParaPagamento,

    classificacao: cls.classificacao,
    classificacao_severidade: cls.severidade,

    processado_em: now,
  };
}

async function reconcileOneShop(shop: ActiveShop) {
  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  const { data: pedidos, error: errP } = await supabase
    .from('shopee_pedidos')
    .select('shop_id, order_sn, order_status, complete_time, update_time')
    .eq('shop_id', shop.shop_id)
    .gte('update_time', sinceIso);
  if (errP) throw new Error(`fetch shopee_pedidos: ${errP.message}`);
  if (!pedidos || pedidos.length === 0) {
    return { shop_id: shop.shop_id, total: 0, changed: 0, by_class: {} };
  }

  const orderSns = pedidos.map(p => p.order_sn as string);

  const [escrowsRes, returnsRes, tinyRes, existingRes] = await Promise.all([
    supabase
      .from('shopee_escrow')
      .select(
        'order_sn, buyer_total_amount, escrow_amount, commission_fee, service_fee, actual_shipping_fee, shopee_shipping_rebate, seller_return_refund, escrow_release_time, payout_amount, is_released',
      )
      .eq('shop_id', shop.shop_id)
      .in('order_sn', orderSns),
    supabase
      .from('shopee_returns')
      .select('order_sn, status, refund_amount, update_time')
      .eq('shop_id', shop.shop_id)
      .in('order_sn', orderSns),
    supabase
      .from('pedidos')
      .select('id, numero_pedido, numero_pedido_ecommerce, situacao, data_entrega, valor_total_pedido')
      .in('numero_pedido_ecommerce', orderSns),
    supabase
      .from('shopee_conciliacao')
      .select('order_sn, classificacao')
      .eq('shop_id', shop.shop_id)
      .in('order_sn', orderSns),
  ]);

  const escrowBySn = new Map<string, ShopeeEscrowRow>();
  for (const e of (escrowsRes.data as ShopeeEscrowRow[] | null) ?? [])
    escrowBySn.set(e.order_sn, e);

  const returnsBySn = new Map<string, ShopeeReturnRow[]>();
  for (const r of (returnsRes.data as ShopeeReturnRow[] | null) ?? []) {
    const list = returnsBySn.get(r.order_sn) ?? [];
    list.push(r);
    returnsBySn.set(r.order_sn, list);
  }
  // Ordenar returns mais recentes primeiro
  Array.from(returnsBySn.values()).forEach((list: ShopeeReturnRow[]) => {
    list.sort((a, b) => (b.update_time ?? '').localeCompare(a.update_time ?? ''));
  });

  const tinyBySn = new Map<string, TinyPedidoRow>();
  for (const t of (tinyRes.data as TinyPedidoRow[] | null) ?? [])
    tinyBySn.set(t.numero_pedido_ecommerce, t);

  const existingBySn = new Map<string, string>();
  for (const c of (existingRes.data as { order_sn: string; classificacao: string }[] | null) ??
    [])
    existingBySn.set(c.order_sn, c.classificacao);

  const now = new Date().toISOString();
  const rows: ReturnType<typeof buildRow>[] = [];
  const logs: Array<{
    shop_id: number;
    order_sn: string;
    classificacao_anterior: string;
    classificacao_nova: string;
    motivo: string;
    dados_snapshot: unknown;
  }> = [];
  const byClass: Record<string, number> = {};

  for (const p of pedidos as ShopeePedidoRow[]) {
    const tiny = tinyBySn.get(p.order_sn) ?? null;
    const escrow = escrowBySn.get(p.order_sn) ?? null;
    const rets = returnsBySn.get(p.order_sn) ?? [];

    const cls = classify(p, escrow, rets, tiny);
    byClass[cls.classificacao] = (byClass[cls.classificacao] ?? 0) + 1;

    rows.push(buildRow(shop.shop_id, p, escrow, rets, tiny, cls, now));

    const prev = existingBySn.get(p.order_sn);
    if (prev && prev !== cls.classificacao) {
      logs.push({
        shop_id: shop.shop_id,
        order_sn: p.order_sn,
        classificacao_anterior: prev,
        classificacao_nova: cls.classificacao,
        motivo: 'reclassificação automática',
        dados_snapshot: {
          order_status: p.order_status,
          is_released: escrow?.is_released ?? null,
          active_return_status: rets[0]?.status ?? null,
          complete_time: p.complete_time,
        },
      });
    }
  }

  // Bulk UPSERT em chunks (Supabase limita tamanho de request)
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from('shopee_conciliacao')
      .upsert(chunk, { onConflict: 'shop_id,order_sn' });
    if (error) throw new Error(`UPSERT shopee_conciliacao: ${error.message}`);
  }

  if (logs.length > 0) {
    const { error } = await supabase.from('shopee_conciliacao_log').insert(logs);
    if (error) console.error('[shopee-sync][reconciliation] log insert:', error.message);
  }

  console.log(
    `[shopee-sync][reconciliation] shop_id=${shop.shop_id} total=${rows.length} changed=${logs.length} byClass=`,
    byClass,
  );

  return { shop_id: shop.shop_id, total: rows.length, changed: logs.length, by_class: byClass };
}

export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const all = await getActiveShops();
  const target = shopIdRaw ? all.filter(s => s.shop_id === Number(shopIdRaw)) : all;
  if (target.length === 0) return NextResponse.json({ error: 'Nenhuma loja ativa' }, { status: 404 });

  const results = [];
  for (const shop of target) {
    try {
      results.push(await reconcileOneShop(shop));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      console.error(`[shopee-sync][reconciliation] shop_id=${shop.shop_id} ERRO:`, msg);
      results.push({ shop_id: shop.shop_id, error: msg });
    }
  }

  const total = results.reduce((s, r) => s + ('total' in r ? r.total : 0), 0);
  const changed = results.reduce((s, r) => s + ('changed' in r ? r.changed : 0), 0);

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: results.length,
    total,
    changed,
    errors: results.filter(r => 'error' in r).length,
    results,
  });
}
