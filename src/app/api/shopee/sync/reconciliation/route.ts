import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  resolveTargetShop,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit } from '@/lib/shopee/audit';

// Reconciliação Tiny × Shopee. Uma loja por execução — round-robin.
// Processa pedidos dos últimos LOOKBACK_DAYS em lotes de CHUNK. Para assim
// que elapsed > MAX_ELAPSED_MS, salvando progresso implicitamente (idempotente).
// Ref: SHOPEE_API_REFERENCE.md §7 (14 estados).

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_reconciliation';
const MAX_ELAPSED_MS = 45 * 1000;
const LOOKBACK_DAYS = 60;
const SLA_DAYS = 15;
const DIVERGENCE_TOLERANCE_PCT = 1.0;
const PROCESS_LIMIT = 5000;
const UPSERT_CHUNK = 500;

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
  order_selling_price: number | null;
  voucher_from_seller: number | null;
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

// Valor bruto Shopee para comparação com o Tiny.
// Preferência: order_selling_price - voucher_from_seller (preço do produto menos
// cupons do seller) — é o que o Tiny registra. buyer_total_amount inflava a
// comparação porque inclui frete + taxa de cartão do buyer, gerando falsos
// PAGO_COM_DIVERGENCIA em ~208 pedidos.
// Fallback: buyer_total_amount, para escrows sem detail sincronizado.
// null quando os dois estão zerados/ausentes → caller marca DADOS_INSUFICIENTES.
function computeValorBrutoShopee(escrow: ShopeeEscrowRow | null): number | null {
  if (!escrow) return null;
  const osp = escrow.order_selling_price ?? 0;
  const vfs = escrow.voucher_from_seller ?? 0;
  if (osp > 0) return Math.round((osp - vfs) * 100) / 100;
  const bta = escrow.buyer_total_amount ?? 0;
  if (bta > 0) return Math.round(bta * 100) / 100;
  return null;
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
  if (!tiny) return { classificacao: 'ORFAO_SHOPEE', severidade: 'critical' };

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
      const shopeeValor = computeValorBrutoShopee(escrow);
      if (shopeeValor == null) {
        return { classificacao: 'DADOS_INSUFICIENTES', severidade: 'info' };
      }
      const tinyValor = tiny.valor_total_pedido ?? 0;
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
  const valorBrutoShopee = computeValorBrutoShopee(escrow);
  const valorLiquidoShopee = escrow?.escrow_amount ?? null;
  const valorBrutoTiny = tiny?.valor_total_pedido ?? null;

  let divergenciaValor: number | null = null;
  let divergenciaPercentual: number | null = null;
  if (valorBrutoTiny != null && valorBrutoShopee != null) {
    divergenciaValor = Math.round((valorBrutoTiny - valorBrutoShopee) * 100) / 100;
    divergenciaPercentual = valorBrutoShopee > 0
      ? Math.round((divergenciaValor / valorBrutoShopee) * 10000) / 100
      : 0;
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

type StoppedReason = 'complete' | 'timeout' | 'no_shops';

async function runOneShop(shop: ActiveShop) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const nowIso = new Date().toISOString();

  const auditId = await startAudit({
    shop_id: shop.shop_id,
    job_name: JOB_NAME,
    window_from: sinceIso,
    window_to: nowIso,
  });

  try {

  const upsertCheckpoint = async (patch: Record<string, unknown>) => {
    const { error } = await supabase.from('shopee_sync_checkpoint').upsert(
      {
        shop_id: shop.shop_id,
        job_name: JOB_NAME,
        last_window_from: sinceIso,
        last_window_to: nowIso,
        is_running: false,
        ...patch,
      },
      { onConflict: 'shop_id,job_name' },
    );
    if (error) console.error('[shopee-sync][reconciliation] checkpoint upsert:', error.message);
  };

  const { data: pedidosData, error: errP } = await supabase
    .from('shopee_pedidos')
    .select('shop_id, order_sn, order_status, complete_time, update_time')
    .eq('shop_id', shop.shop_id)
    .gte('update_time', sinceIso)
    .order('update_time', { ascending: false })
    .limit(PROCESS_LIMIT);
  if (errP) throw new Error(`fetch shopee_pedidos: ${errP.message}`);

  const pedidos = (pedidosData as ShopeePedidoRow[] | null) ?? [];
  if (pedidos.length === 0) {
    await upsertCheckpoint({
      last_success_at: nowIso,
      last_error_at: null,
      last_error_message: null,
    });
    await finishAudit(auditId, 'success', { rows_read: 0 }, startedAt);
    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: 0, changed: 0,
      duration_ms: elapsed(), stopped_reason: 'complete' as StoppedReason, next_cursor: null,
      by_class: {},
    };
  }

  const orderSns = pedidos.map(p => p.order_sn);

  const [escrowsRes, returnsRes, tinyRes, existingRes] = await Promise.all([
    supabase
      .from('shopee_escrow')
      .select(
        'order_sn, buyer_total_amount, order_selling_price, voucher_from_seller, escrow_amount, commission_fee, service_fee, actual_shipping_fee, shopee_shipping_rebate, seller_return_refund, escrow_release_time, payout_amount, is_released',
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
  let stoppedReason: StoppedReason = 'complete';
  let processed = 0;

  for (const p of pedidos) {
    if (elapsed() >= MAX_ELAPSED_MS) {
      stoppedReason = 'timeout';
      break;
    }

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
    processed++;
  }

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    if (elapsed() >= MAX_ELAPSED_MS) {
      stoppedReason = 'timeout';
      break;
    }
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('shopee_conciliacao')
      .upsert(chunk, { onConflict: 'shop_id,order_sn' });
    if (error) throw new Error(`UPSERT shopee_conciliacao: ${error.message}`);
  }

  if (logs.length > 0) {
    const { error } = await supabase.from('shopee_conciliacao_log').insert(logs);
    if (error) console.error('[shopee-sync][reconciliation] log insert:', error.message);
  }

  // Progresso parcial (timeout) também conta como sucesso — o próximo run completa.
  await upsertCheckpoint({
    last_success_at: new Date().toISOString(),
    last_error_at: null,
    last_error_message: null,
  });

  console.log(
    `[shopee-sync][reconciliation] shop_id=${shop.shop_id} processed=${processed}/${pedidos.length} changed=${logs.length} reason=${stoppedReason} byClass=`,
    byClass,
  );

  await finishAudit(
    auditId,
    stoppedReason === 'timeout' ? 'partial' : 'success',
    {
      rows_read: processed,
      rows_updated: logs.length,
      metadata: { stopped_reason: stoppedReason, by_class: byClass },
    },
    startedAt,
  );

  return {
    job: JOB_NAME, shop_id: shop.shop_id, processed, changed: logs.length,
    duration_ms: elapsed(), stopped_reason: stoppedReason, next_cursor: null,
    by_class: byClass,
  };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][reconciliation] shop_id=${shop.shop_id} ERRO:`, msg);
    await finishAudit(auditId, 'error', { errors_count: 1, error_message: msg }, startedAt);
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const shopIdParam = request.nextUrl.searchParams.get('shop_id');
  const shop = await resolveTargetShop(JOB_NAME, shopIdParam);
  if (!shop) {
    return NextResponse.json({
      job: JOB_NAME, shop_id: null, processed: 0, changed: 0, duration_ms: 0,
      stopped_reason: 'no_shops' as const, next_cursor: null,
    });
  }

  try {
    return NextResponse.json(await runOneShop(shop));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { job: JOB_NAME, shop_id: shop.shop_id, error: msg },
      { status: 502 },
    );
  }
}
