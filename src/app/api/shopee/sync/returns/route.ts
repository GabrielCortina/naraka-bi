import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  resolveTargetShop,
  lockCheckpoint,
  updateCheckpoint,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync incremental de returns. Uma loja + até MAX_PAGES páginas por execução.
// Janela MAX 14 dias. Ref: SHOPEE_API_REFERENCE.md §3.3.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_returns';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 400;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 14;
const WINDOW_MAX_DAYS = 14;
const PAGE_SIZE = 20;
const MAX_PAGES_PER_RUN = 2;

interface ReturnItem {
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
  negotiation_status?: string;
  return_refund_type?: string;
}
interface ReturnListResp { more?: boolean; return?: ReturnItem[] }

type StoppedReason =
  | 'complete' | 'page_limit' | 'window_advanced'
  | 'timeout' | 'already_running' | 'no_shops';

async function runOneShop(shop: ActiveShop) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timeLeft = () => MAX_ELAPSED_MS - elapsed();

  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) {
    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: 0,
      duration_ms: elapsed(), stopped_reason: 'already_running' as StoppedReason,
      next_cursor: null as string | null,
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
    let pageNo = 1;

    if (ck?.last_cursor && ck.last_window_from && ck.last_window_to) {
      windowFromSec = Math.floor(new Date(ck.last_window_from).getTime() / 1000);
      windowToSec = Math.floor(new Date(ck.last_window_to).getTime() / 1000);
      pageNo = Math.max(1, parseInt(ck.last_cursor, 10));
    } else if (ck?.last_success_at && ck.last_window_to) {
      const prevTo = Math.floor(new Date(ck.last_window_to).getTime() / 1000);
      windowFromSec = prevTo - WINDOW_OVERLAP_SEC;
      windowToSec = Math.min(windowFromSec + WINDOW_MAX_DAYS * 86400, nowSec);
    } else {
      windowFromSec = nowSec - BACKFILL_DAYS * 86400;
      windowToSec = nowSec;
    }

    const windowFromIso = new Date(windowFromSec * 1000).toISOString();
    const windowToIso = new Date(windowToSec * 1000).toISOString();

    let totalReturns = 0;
    let pagesConsumed = 0;
    let moreAfter = false;
    let stoppedReason: StoppedReason = 'complete';

    while (pagesConsumed < MAX_PAGES_PER_RUN) {
      if (timeLeft() < 5000) { stoppedReason = 'timeout'; break; }

      const resp = await shopeeCallWithRefresh<ReturnListResp>(
        shop,
        '/api/v2/returns/get_return_list',
        {
          page_no: pageNo,
          page_size: PAGE_SIZE,
          create_time_from: windowFromSec,
          create_time_to: windowToSec,
        },
      );
      await sleep(THROTTLE_MS);

      const items = resp.response?.return ?? [];
      if (items.length === 0) { moreAfter = false; break; }

      const rows = items
        .filter(r => r.return_sn && r.order_sn)
        .map(r => ({
          shop_id: shop.shop_id,
          return_sn: r.return_sn!,
          order_sn: r.order_sn!,
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
          negotiation_status: r.negotiation_status ?? null,
          return_refund_type: r.return_refund_type ?? null,
          synced_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('shopee_returns')
          .upsert(rows, { onConflict: 'shop_id,return_sn' });
        if (error) throw new Error(`UPSERT shopee_returns: ${error.message}`);
      }
      totalReturns += rows.length;

      pagesConsumed++;
      moreAfter = resp.response?.more === true;
      if (!moreAfter) break;
      pageNo++;
    }

    if (pagesConsumed === MAX_PAGES_PER_RUN && moreAfter && stoppedReason === 'complete') {
      stoppedReason = 'page_limit';
    }

    const nextPageStr = moreAfter && (stoppedReason === 'page_limit' || stoppedReason === 'timeout')
      ? String(pageNo + (stoppedReason === 'page_limit' ? 1 : 0))
      : null;

    if (stoppedReason === 'page_limit' || stoppedReason === 'timeout') {
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: windowToIso,
        last_cursor: nextPageStr,
        is_running: false,
      });
    } else if (windowToSec < nowSec - 60) {
      stoppedReason = 'window_advanced';
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: windowToIso,
        last_cursor: null,
        last_success_at: new Date().toISOString(),
        last_error_at: null, last_error_message: null,
        is_running: false,
      });
    } else {
      await updateCheckpoint(shop.shop_id, JOB_NAME, {
        last_window_from: windowFromIso,
        last_window_to: new Date(nowSec * 1000).toISOString(),
        last_cursor: null,
        last_success_at: new Date().toISOString(),
        last_error_at: null, last_error_message: null,
        is_running: false,
      });
    }

    console.log(
      `[shopee-sync][returns] shop_id=${shop.shop_id} returns=${totalReturns} pages=${pagesConsumed} reason=${stoppedReason}`,
    );

    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: totalReturns,
      duration_ms: elapsed(), stopped_reason: stoppedReason, next_cursor: nextPageStr,
      window: { from: windowFromIso, to: windowToIso },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][returns] shop_id=${shop.shop_id} ERRO:`, msg);
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
  const shop = await resolveTargetShop(JOB_NAME, shopIdParam);
  if (!shop) {
    return NextResponse.json({
      job: JOB_NAME, shop_id: null, processed: 0, duration_ms: 0,
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
