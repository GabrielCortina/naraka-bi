import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  resolveTargetShop,
  lockCheckpoint,
  updateCheckpoint,
  enqueueAction,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync incremental de pedidos — UMA loja + UMA página de list + UM chunk de
// detail por execução. Multi-execução via cron: cada run avança um "pedaço"
// e o checkpoint carrega o estado.
//
// ?shop_id=<n>    — força loja específica (bypass round-robin)
// ?days=<n>       — força janela de N dias a partir de agora (bypass checkpoint)
//
// Ref: SHOPEE_API_REFERENCE.md §3.1, shopee-payment-docs.md §8.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_orders';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 300;
const WINDOW_OVERLAP_SEC = 5 * 60;
const FIRST_RUN_DAYS = 3;
const WINDOW_MAX_DAYS = 14;
const LIST_PAGE_SIZE = 50;
const DETAIL_CHUNK = 50;

const DETAIL_FIELDS = [
  'total_amount', 'pay_time', 'item_list', 'payment_method',
  'shipping_carrier', 'fulfillment_flag', 'estimated_shipping_fee',
  'actual_shipping_fee', 'cod', 'pickup_done_time',
].join(',');

interface OrderListItem { order_sn: string; order_status?: string }
interface OrderListResp { more?: boolean; next_cursor?: string; order_list?: OrderListItem[] }
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
interface OrderDetailResp { order_list?: OrderDetailItem[] }

type StoppedReason =
  | 'complete'
  | 'page_limit'
  | 'window_advanced'
  | 'timeout'
  | 'already_running'
  | 'no_shops';

interface Summary {
  job: string;
  shop_id: number | null;
  processed: number;
  enqueued: number;
  duration_ms: number;
  stopped_reason: StoppedReason;
  next_cursor: string | null;
  window?: { from: string; to: string };
}

async function runOneShop(shop: ActiveShop, forcedDays: number | null): Promise<Summary> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timeLeft = () => MAX_ELAPSED_MS - elapsed();

  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) {
    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: 0, enqueued: 0,
      duration_ms: elapsed(), stopped_reason: 'already_running', next_cursor: null,
    };
  }

  try {
    const supabase = createServiceClient();
    const { data: ck } = await supabase
      .from('shopee_sync_checkpoint')
      .select('last_window_from, last_window_to, last_cursor, last_success_at')
      .eq('shop_id', shop.shop_id)
      .eq('job_name', JOB_NAME)
      .single();

    const nowSec = Math.floor(Date.now() / 1000);
    let windowFromSec: number;
    let windowToSec: number;
    let cursor = '';

    if (forcedDays) {
      windowFromSec = nowSec - forcedDays * 86400;
      windowToSec = nowSec;
    } else if (ck?.last_cursor && ck.last_window_from && ck.last_window_to) {
      windowFromSec = Math.floor(new Date(ck.last_window_from).getTime() / 1000);
      windowToSec = Math.floor(new Date(ck.last_window_to).getTime() / 1000);
      cursor = ck.last_cursor;
    } else if (ck?.last_success_at && ck.last_window_to) {
      const prevTo = Math.floor(new Date(ck.last_window_to).getTime() / 1000);
      windowFromSec = prevTo - WINDOW_OVERLAP_SEC;
      windowToSec = Math.min(windowFromSec + WINDOW_MAX_DAYS * 86400, nowSec);
    } else {
      windowFromSec = nowSec - FIRST_RUN_DAYS * 86400;
      windowToSec = nowSec;
    }

    const windowFromIso = new Date(windowFromSec * 1000).toISOString();
    const windowToIso = new Date(windowToSec * 1000).toISOString();

    const listResp = await shopeeCallWithRefresh<OrderListResp>(
      shop,
      '/api/v2/order/get_order_list',
      {
        time_range_field: 'update_time',
        time_from: windowFromSec,
        time_to: windowToSec,
        page_size: LIST_PAGE_SIZE,
        cursor,
      },
    );
    await sleep(THROTTLE_MS);

    const snList = (listResp.response?.order_list ?? []).map(o => o.order_sn);
    const more = listResp.response?.more === true;
    const nextCursorApi = listResp.response?.next_cursor || null;

    let processed = 0;
    let enqueued = 0;

    if (snList.length > 0) {
      if (timeLeft() < 5000) {
        await updateCheckpoint(shop.shop_id, JOB_NAME, {
          last_window_from: windowFromIso,
          last_window_to: windowToIso,
          last_cursor: cursor || null,
          is_running: false,
        });
        return {
          job: JOB_NAME, shop_id: shop.shop_id, processed, enqueued,
          duration_ms: elapsed(), stopped_reason: 'timeout',
          next_cursor: cursor || null,
          window: { from: windowFromIso, to: windowToIso },
        };
      }

      const chunk = snList.slice(0, DETAIL_CHUNK);
      const detailResp = await shopeeCallWithRefresh<OrderDetailResp>(
        shop,
        '/api/v2/order/get_order_detail',
        { order_sn_list: chunk.join(','), response_optional_fields: DETAIL_FIELDS },
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
        if (error) throw new Error(`UPSERT shopee_pedidos: ${error.message}`);
      }

      for (const item of items) {
        const prev = snToPrev[item.order_sn];
        if (item.order_status === 'COMPLETED' && prev?.order_status !== 'COMPLETED') {
          const created = await enqueueAction(
            shop.shop_id, 'escrow', item.order_sn, 'fetch_escrow_detail', 3,
          );
          if (created) enqueued++;
        }
      }

      processed = items.length;
    }

    let stoppedReason: StoppedReason;
    let nextCursorOut: string | null = null;

    if (more && nextCursorApi) {
      stoppedReason = 'page_limit';
      nextCursorOut = nextCursorApi;
      // Progresso parcial ainda é sucesso — registra last_success_at para o
      // monitoramento não mostrar "nunca executou" durante o backfill.
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: windowToIso,
        last_cursor: nextCursorApi,
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_message: null,
        is_running: false,
      });
    } else if (windowToSec < nowSec - 60) {
      stoppedReason = 'window_advanced';
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: windowToIso,
        last_cursor: null,
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_message: null,
        is_running: false,
      });
    } else {
      stoppedReason = 'complete';
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: new Date(nowSec * 1000).toISOString(),
        last_cursor: null,
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_message: null,
        is_running: false,
      });
    }

    console.log(
      `[shopee-sync][orders] shop_id=${shop.shop_id} processed=${processed} enqueued=${enqueued} reason=${stoppedReason} elapsed=${elapsed()}ms`,
    );

    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed, enqueued,
      duration_ms: elapsed(), stopped_reason: stoppedReason, next_cursor: nextCursorOut,
      window: { from: windowFromIso, to: windowToIso },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][orders] shop_id=${shop.shop_id} ERRO:`, msg);
    await updateCheckpoint(shop.shop_id, JOB_NAME, {
      last_error_at: new Date().toISOString(),
      last_error_message: msg,
      is_running: false,
    });
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const shopIdParam = request.nextUrl.searchParams.get('shop_id');
  const daysRaw = request.nextUrl.searchParams.get('days');

  let forcedDays: number | null = null;
  if (daysRaw != null) {
    const parsed = Number(daysRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'days deve ser inteiro positivo' }, { status: 400 });
    }
    forcedDays = parsed;
  }

  const shop = await resolveTargetShop(JOB_NAME, shopIdParam);
  if (!shop) {
    return NextResponse.json({
      job: JOB_NAME, shop_id: null, processed: 0, enqueued: 0,
      duration_ms: 0, stopped_reason: 'no_shops' as const, next_cursor: null,
    });
  }

  try {
    return NextResponse.json(await runOneShop(shop, forcedDays));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { job: JOB_NAME, shop_id: shop.shop_id, error: msg },
      { status: 502 },
    );
  }
}
