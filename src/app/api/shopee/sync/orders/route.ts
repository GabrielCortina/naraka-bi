import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getActiveShops,
  lockCheckpoint,
  updateCheckpoint,
  enqueueAction,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync de pedidos: lista (get_order_list) + detalhes em chunks de 50
// (get_order_detail, GET com CSV na query). Em transição para COMPLETED
// enfileira fetch_escrow_detail. Checkpoint: sync_orders.
// Ref: SHOPEE_API_REFERENCE.md §3.1, shopee-payment-docs.md §8.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const JOB_NAME = 'sync_orders';
const THROTTLE_MS = 500;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_WINDOW_DAYS = 15;
const WINDOW_MAX_DAYS = 14;
const DETAIL_CHUNK = 50;
const LIST_PAGE_SIZE = 100;

const DETAIL_FIELDS = [
  'total_amount', 'pay_time', 'item_list', 'payment_method',
  'shipping_carrier', 'fulfillment_flag', 'estimated_shipping_fee',
  'actual_shipping_fee', 'cod', 'pickup_done_time',
].join(',');

interface OrderListItem {
  order_sn: string;
  order_status?: string;
}
interface OrderListResponse {
  more?: boolean;
  next_cursor?: string;
  order_list?: OrderListItem[];
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
interface OrderDetailResponse {
  order_list?: OrderDetailItem[];
}

interface ShopResult {
  shop_id: number;
  orders?: number;
  enqueued?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

async function syncOneShop(shop: ActiveShop): Promise<ShopResult> {
  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) {
    console.log(`[shopee-sync][orders] shop_id=${shop.shop_id} já está rodando — skip`);
    return { shop_id: shop.shop_id, skipped: true, reason: 'already_running' };
  }

  try {
    const supabase = createServiceClient();
    const { data: ck } = await supabase
      .from('shopee_sync_checkpoint')
      .select('last_window_to, last_success_at')
      .eq('shop_id', shop.shop_id)
      .eq('job_name', JOB_NAME)
      .single();

    const nowSec = Math.floor(Date.now() / 1000);
    let fromSec: number;
    if (ck?.last_success_at && ck.last_window_to) {
      fromSec =
        Math.floor(new Date(ck.last_window_to).getTime() / 1000) - WINDOW_OVERLAP_SEC;
    } else {
      fromSec = nowSec - BACKFILL_WINDOW_DAYS * 86400;
    }

    let totalOrders = 0;
    let totalEnqueued = 0;
    let windowFrom = fromSec;

    while (windowFrom < nowSec) {
      const windowTo = Math.min(windowFrom + WINDOW_MAX_DAYS * 86400, nowSec);
      const r = await syncWindow(shop, windowFrom, windowTo);
      totalOrders += r.orders;
      totalEnqueued += r.enqueued;
      windowFrom = windowTo;
    }

    await updateCheckpoint(shop.shop_id, JOB_NAME, {
      last_window_from: new Date(fromSec * 1000).toISOString(),
      last_window_to: new Date(nowSec * 1000).toISOString(),
      last_success_at: new Date().toISOString(),
      last_error_at: null,
      last_error_message: null,
      is_running: false,
    });

    console.log(
      `[shopee-sync][orders] shop_id=${shop.shop_id} ok: ${totalOrders} pedidos, ${totalEnqueued} enfileirados`,
    );
    return { shop_id: shop.shop_id, orders: totalOrders, enqueued: totalEnqueued };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][orders] shop_id=${shop.shop_id} ERRO:`, msg);
    await updateCheckpoint(shop.shop_id, JOB_NAME, {
      last_error_at: new Date().toISOString(),
      last_error_message: msg,
      is_running: false,
    });
    return { shop_id: shop.shop_id, error: msg };
  }
}

async function syncWindow(shop: ActiveShop, timeFrom: number, timeTo: number) {
  const supabase = createServiceClient();
  let cursor = '';
  let ordersProcessed = 0;
  let enqueued = 0;

  while (true) {
    const listResp = await shopeeCallWithRefresh<OrderListResponse>(
      shop,
      '/api/v2/order/get_order_list',
      {
        time_range_field: 'update_time',
        time_from: timeFrom,
        time_to: timeTo,
        page_size: LIST_PAGE_SIZE,
        cursor,
      },
    );
    await sleep(THROTTLE_MS);

    const snList = (listResp.response?.order_list ?? []).map((o: OrderListItem) => o.order_sn);
    if (snList.length === 0) break;

    for (let i = 0; i < snList.length; i += DETAIL_CHUNK) {
      const chunk = snList.slice(i, i + DETAIL_CHUNK);

      const detailResp = await shopeeCallWithRefresh<OrderDetailResponse>(
        shop,
        '/api/v2/order/get_order_detail',
        {
          order_sn_list: chunk.join(','),
          response_optional_fields: DETAIL_FIELDS,
        },
      );
      await sleep(THROTTLE_MS);

      const items = detailResp.response?.order_list ?? [];

      const snToPrev: Record<string, { order_status: string | null; complete_time: string | null }> = {};
      const { data: prevRows } = await supabase
        .from('shopee_pedidos')
        .select('order_sn, order_status, complete_time')
        .eq('shop_id', shop.shop_id)
        .in('order_sn', chunk);
      for (const p of prevRows ?? []) {
        snToPrev[p.order_sn as string] = {
          order_status: (p.order_status as string | null) ?? null,
          complete_time: (p.complete_time as string | null) ?? null,
        };
      }

      const rows = items.map((item: OrderDetailItem) => {
        const prev = snToPrev[item.order_sn];
        const updateIso = tsToIso(item.update_time);
        let completeTime = prev?.complete_time ?? null;
        if (item.order_status === 'COMPLETED' && !completeTime) {
          completeTime = updateIso ?? new Date().toISOString();
        }
        return {
          shop_id: shop.shop_id,
          order_sn: item.order_sn,
          order_status: item.order_status ?? null,
          currency: item.currency ?? 'BRL',
          total_amount: item.total_amount ?? null,
          payment_method: item.payment_method ?? null,
          shipping_carrier: item.shipping_carrier ?? null,
          estimated_shipping_fee: item.estimated_shipping_fee ?? null,
          actual_shipping_fee: item.actual_shipping_fee ?? null,
          create_time: tsToIso(item.create_time),
          pay_time: tsToIso(item.pay_time),
          ship_time: tsToIso(item.pickup_done_time),
          complete_time: completeTime,
          update_time: updateIso,
          fulfillment_flag: item.fulfillment_flag ?? null,
          cod: item.cod ?? false,
          synced_at: new Date().toISOString(),
        };
      });

      if (rows.length > 0) {
        const { error } = await supabase
          .from('shopee_pedidos')
          .upsert(rows, { onConflict: 'shop_id,order_sn' });
        if (error) throw new Error(`UPSERT shopee_pedidos falhou: ${error.message}`);
      }

      for (const item of items) {
        const prev = snToPrev[item.order_sn];
        if (item.order_status === 'COMPLETED' && prev?.order_status !== 'COMPLETED') {
          const created = await enqueueAction(
            shop.shop_id,
            'escrow',
            item.order_sn,
            'fetch_escrow_detail',
            3,
          );
          if (created) enqueued++;
        }
      }

      ordersProcessed += items.length;
    }

    if (!listResp.response?.more) break;
    cursor = listResp.response?.next_cursor ?? '';
    if (!cursor) break;
  }

  return { orders: ordersProcessed, enqueued };
}

export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const all = await getActiveShops();
  const target = shopIdRaw ? all.filter(s => s.shop_id === Number(shopIdRaw)) : all;

  if (target.length === 0) {
    return NextResponse.json({ error: 'Nenhuma loja ativa encontrada' }, { status: 404 });
  }

  console.log(`[shopee-sync][orders] iniciando — ${target.length} loja(s)`);
  const results: ShopResult[] = [];
  for (const shop of target) {
    results.push(await syncOneShop(shop));
  }

  const summary = {
    job: JOB_NAME,
    shops_processed: results.length,
    orders: results.reduce((s, r) => s + (r.orders ?? 0), 0),
    enqueued: results.reduce((s, r) => s + (r.enqueued ?? 0), 0),
    errors: results.filter(r => r.error).length,
    results,
  };
  console.log('[shopee-sync][orders] concluído:', summary);
  return NextResponse.json(summary);
}
