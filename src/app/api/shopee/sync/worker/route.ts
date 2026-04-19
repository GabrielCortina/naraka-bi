import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getShopById,
  shopeeCallWithRefresh,
  sleep,
  calculateBackoffMinutes,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';
import { mapEscrowDetailToRow, type EscrowDetailResponse } from '@/lib/shopee/escrow-mapper';

// Worker da fila shopee_sync_queue. Processa até BATCH_SIZE items por
// execução, checando timeout entre items. Actions suportadas:
//   - fetch_escrow_detail  (entity_id = order_sn)
//   - fetch_return_detail  (entity_id = return_sn)
//   - fetch_order_detail   (entity_id = order_sn)

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const BATCH_SIZE = 15;
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
const THROTTLE_MS = 1000;
const MAX_ELAPSED_MS = 45 * 1000;

interface QueueItem {
  id: number;
  shop_id: number;
  entity_type: string;
  entity_id: string | null;
  action: string;
  attempt_count: number;
  max_attempts: number;
  metadata: Record<string, unknown> | null;
}

interface EscrowShopRes {
  order_sn: string;
  buyer_user_name?: string;
  return_order_sn_list?: string[];
  order_income?: Record<string, unknown>;
  buyer_payment_info?: Record<string, unknown>;
}

interface ReturnDetailRes {
  return_sn?: string;
  order_sn?: string;
  status?: string;
  reason?: string;
  text_reason?: string;
  refund_amount?: number;
  currency?: string;
  amount_before_discount?: number;
  needs_logistics?: boolean;
  tracking_number?: string;
  create_time?: number;
  update_time?: number;
  due_date?: number;
  return_ship_due_date?: number;
  return_seller_due_date?: number;
  return_refund_type?: string;
  negotiation?: { negotiation_status?: string };
}

interface OrderDetailItem {
  order_sn: string;
  order_status?: string;
  currency?: string;
  total_amount?: number;
  payment_method?: string;
  shipping_carrier?: string;
  estimated_shipping_fee?: number;
  actual_shipping_fee?: number;
  create_time?: number;
  pay_time?: number;
  update_time?: number;
  pickup_done_time?: number;
  fulfillment_flag?: string;
  cod?: boolean;
}

async function unstickProcessing(): Promise<number> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
  const { data } = await supabase
    .from('shopee_sync_queue')
    .update({ status: 'PENDING' })
    .eq('status', 'PROCESSING')
    .lt('updated_at', cutoff)
    .select('id');
  return data?.length ?? 0;
}

async function claimItems(): Promise<QueueItem[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_sync_queue')
    .select('id, shop_id, entity_type, entity_id, action, attempt_count, max_attempts, metadata')
    .eq('status', 'PENDING')
    .lte('next_retry_at', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (!data || data.length === 0) return [];

  const ids = data.map(d => d.id);
  const { data: claimed } = await supabase
    .from('shopee_sync_queue')
    .update({ status: 'PROCESSING' })
    .in('id', ids)
    .eq('status', 'PENDING')
    .select('id, shop_id, entity_type, entity_id, action, attempt_count, max_attempts, metadata');

  return (claimed as QueueItem[] | null) ?? [];
}

async function markDone(itemId: number): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('shopee_sync_queue')
    .update({ status: 'DONE', completed_at: new Date().toISOString(), last_error: null })
    .eq('id', itemId);
}

async function markFailed(item: QueueItem, error: string): Promise<'FAILED' | 'DEAD'> {
  const supabase = createServiceClient();
  const nextAttempt = item.attempt_count + 1;
  if (nextAttempt >= item.max_attempts) {
    await supabase
      .from('shopee_sync_queue')
      .update({
        status: 'DEAD',
        attempt_count: nextAttempt,
        last_error: error,
        completed_at: new Date().toISOString(),
      })
      .eq('id', item.id);
    return 'DEAD';
  }
  const backoffMin = calculateBackoffMinutes(nextAttempt);
  await supabase
    .from('shopee_sync_queue')
    .update({
      status: 'PENDING',
      attempt_count: nextAttempt,
      next_retry_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
      last_error: error,
    })
    .eq('id', item.id);
  return 'FAILED';
}

async function handleFetchEscrowDetail(item: QueueItem, shop: ActiveShop) {
  if (!item.entity_id) throw new Error('fetch_escrow_detail requer entity_id (order_sn)');
  const resp = await shopeeCallWithRefresh<EscrowShopRes>(
    shop,
    '/api/v2/payment/get_escrow_detail',
    { order_sn: item.entity_id },
  );
  const response = resp.response as EscrowDetailResponse | undefined;
  if (!response?.order_sn) throw new Error('get_escrow_detail retornou sem order_sn');

  const row = mapEscrowDetailToRow(shop.shop_id, response, response);

  const supabase = createServiceClient();
  const { data: existing } = await supabase
    .from('shopee_escrow')
    .select('escrow_release_time, payout_amount, is_released')
    .eq('shop_id', shop.shop_id)
    .eq('order_sn', row.order_sn)
    .maybeSingle();

  const { error } = await supabase.from('shopee_escrow').upsert(
    {
      ...row,
      escrow_release_time: existing?.escrow_release_time ?? null,
      payout_amount: existing?.payout_amount ?? null,
      is_released: existing?.is_released ?? false,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id,order_sn' },
  );
  if (error) throw new Error(`UPSERT shopee_escrow: ${error.message}`);
}

async function handleFetchReturnDetail(item: QueueItem, shop: ActiveShop) {
  if (!item.entity_id) throw new Error('fetch_return_detail requer entity_id (return_sn)');
  const resp = await shopeeCallWithRefresh<ReturnDetailRes>(
    shop,
    '/api/v2/returns/get_return_detail',
    { return_sn: item.entity_id },
  );
  const r = resp.response as ReturnDetailRes | undefined;
  if (!r?.return_sn) throw new Error('get_return_detail retornou sem return_sn');

  const supabase = createServiceClient();
  const { error } = await supabase.from('shopee_returns').upsert(
    {
      shop_id: shop.shop_id,
      return_sn: r.return_sn,
      order_sn: r.order_sn ?? (item.metadata?.order_sn as string) ?? '',
      status: r.status ?? null,
      reason: r.reason ?? null,
      text_reason: r.text_reason ?? null,
      refund_amount: r.refund_amount ?? null,
      currency: r.currency ?? 'BRL',
      amount_before_discount: r.amount_before_discount ?? null,
      needs_logistics: r.needs_logistics ?? null,
      tracking_number: r.tracking_number ?? null,
      create_time: tsToIso(r.create_time),
      update_time: tsToIso(r.update_time),
      due_date: tsToIso(r.due_date),
      return_ship_due_date: tsToIso(r.return_ship_due_date),
      return_seller_due_date: tsToIso(r.return_seller_due_date),
      negotiation_status: r.negotiation?.negotiation_status ?? null,
      return_refund_type: r.return_refund_type ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id,return_sn' },
  );
  if (error) throw new Error(`UPSERT shopee_returns: ${error.message}`);
}

async function handleFetchOrderDetail(item: QueueItem, shop: ActiveShop) {
  if (!item.entity_id) throw new Error('fetch_order_detail requer entity_id (order_sn)');
  const resp = await shopeeCallWithRefresh<{ order_list?: OrderDetailItem[] }>(
    shop,
    '/api/v2/order/get_order_detail',
    {
      order_sn_list: item.entity_id,
      response_optional_fields:
        'total_amount,pay_time,item_list,payment_method,shipping_carrier,fulfillment_flag,estimated_shipping_fee,actual_shipping_fee,cod,pickup_done_time',
    },
  );
  const items = resp.response?.order_list ?? [];
  if (items.length === 0) throw new Error('get_order_detail retornou order_list vazio');

  const supabase = createServiceClient();
  const rows = items.map(it => ({
    shop_id: shop.shop_id,
    order_sn: it.order_sn,
    order_status: it.order_status ?? null,
    currency: it.currency ?? 'BRL',
    total_amount: it.total_amount ?? null,
    payment_method: it.payment_method ?? null,
    shipping_carrier: it.shipping_carrier ?? null,
    estimated_shipping_fee: it.estimated_shipping_fee ?? null,
    actual_shipping_fee: it.actual_shipping_fee ?? null,
    create_time: tsToIso(it.create_time),
    pay_time: tsToIso(it.pay_time),
    ship_time: tsToIso(it.pickup_done_time),
    update_time: tsToIso(it.update_time),
    fulfillment_flag: it.fulfillment_flag ?? null,
    cod: it.cod ?? false,
    synced_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('shopee_pedidos')
    .upsert(rows, { onConflict: 'shop_id,order_sn' });
  if (error) throw new Error(`UPSERT shopee_pedidos: ${error.message}`);
}

async function processItem(item: QueueItem): Promise<'ok' | 'fail' | 'dead'> {
  const shop = await getShopById(item.shop_id);
  if (!shop) {
    await markFailed({ ...item, attempt_count: item.max_attempts - 1 }, 'Loja inativa');
    return 'dead';
  }

  try {
    switch (item.action) {
      case 'fetch_escrow_detail':
        await handleFetchEscrowDetail(item, shop);
        break;
      case 'fetch_return_detail':
        await handleFetchReturnDetail(item, shop);
        break;
      case 'fetch_order_detail':
        await handleFetchOrderDetail(item, shop);
        break;
      default:
        throw new Error(`action não suportada no worker: ${item.action}`);
    }
    await markDone(item.id);
    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(
      `[shopee-sync][worker] item=${item.id} action=${item.action} shop_id=${item.shop_id}:`,
      msg,
    );
    const outcome = await markFailed(item, msg);
    return outcome === 'DEAD' ? 'dead' : 'fail';
  }
}

export async function GET() {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const unstuck = await unstickProcessing();
  if (unstuck > 0) console.log(`[shopee-sync][worker] unstuck=${unstuck}`);

  const items = await claimItems();
  if (items.length === 0) {
    return NextResponse.json({
      job: 'worker',
      processed: 0, succeeded: 0, failed: 0, dead: 0, unstuck,
      duration_ms: elapsed(),
      stopped_reason: 'complete' as const,
    });
  }

  console.log(`[shopee-sync][worker] claimed=${items.length}`);

  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  let processed = 0;
  let stoppedReason: 'complete' | 'timeout' = 'complete';

  for (const item of items) {
    if (elapsed() >= MAX_ELAPSED_MS) {
      stoppedReason = 'timeout';
      console.log(`[shopee-sync][worker] timeout após ${processed}/${items.length} items`);
      break;
    }
    const outcome = await processItem(item);
    processed++;
    if (outcome === 'ok') succeeded++;
    else if (outcome === 'dead') dead++;
    else failed++;
    if (elapsed() < MAX_ELAPSED_MS - THROTTLE_MS) await sleep(THROTTLE_MS);
  }

  const summary = {
    job: 'worker',
    processed, succeeded, failed, dead, unstuck,
    duration_ms: elapsed(),
    stopped_reason: stoppedReason,
  };
  console.log('[shopee-sync][worker] concluído:', summary);
  return NextResponse.json(summary);
}
