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
import { mapEscrowDetailToRow, type EscrowDetailResponse } from '@/lib/shopee/escrow-mapper';

// Sync incremental de escrow list (liberações). Uma loja + até MAX_PAGES
// páginas (page_no) por execução. page_no persistido em last_cursor.
// Ref: SHOPEE_API_REFERENCE.md §3.2 — janela MAX 30 dias.
//
// Para cada item do escrow_list:
//   - Se o escrow já tem detail completo no banco → só atualiza release info.
//   - Se falta detail e ainda cabe no orçamento de chamadas da run → chama
//     get_escrow_detail INLINE e faz upsert completo (sem depender do worker).
//   - Se esgotou o orçamento → upsert parcial (release info) + enfileira no worker.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_escrow_list';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 400;
const DETAIL_THROTTLE_MS = 500;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 30;
const WINDOW_MAX_DAYS = 30;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 3;
const MAX_DETAILS_PER_RUN = 50;

interface EscrowListItem {
  order_sn: string;
  payout_amount?: number;
  escrow_release_time?: number;
}
interface EscrowListResp {
  more?: boolean;
  escrow_list?: EscrowListItem[];
}

type StoppedReason =
  | 'complete'
  | 'page_limit'
  | 'window_advanced'
  | 'timeout'
  | 'already_running'
  | 'no_shops';

type ItemAction = 'updated' | 'fetched' | 'enqueued' | 'failed_enqueued';

interface ProcessResult {
  action: ItemAction;
  detailFetched: boolean;
}

async function upsertReleaseOnly(
  supabase: ReturnType<typeof createServiceClient>,
  shopId: number,
  item: EscrowListItem,
): Promise<void> {
  const { error } = await supabase.from('shopee_escrow').upsert(
    {
      shop_id: shopId,
      order_sn: item.order_sn,
      escrow_release_time: tsToIso(item.escrow_release_time),
      payout_amount: item.payout_amount ?? null,
      is_released: true,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'shop_id,order_sn' },
  );
  if (error) throw new Error(`UPSERT shopee_escrow (release): ${error.message}`);
}

async function processEscrowListItem(
  shop: ActiveShop,
  item: EscrowListItem,
  hasDetail: boolean,
  budgetAvailable: boolean,
  supabase: ReturnType<typeof createServiceClient>,
): Promise<ProcessResult> {
  // Caso 1 — linha já tem detail: só atualiza release info.
  if (hasDetail) {
    await upsertReleaseOnly(supabase, shop.shop_id, item);
    return { action: 'updated', detailFetched: false };
  }

  // Caso 2 — estourou orçamento de chamadas de detail: upsert parcial + worker.
  if (!budgetAvailable) {
    await upsertReleaseOnly(supabase, shop.shop_id, item);
    await enqueueAction(
      shop.shop_id, 'escrow', item.order_sn, 'fetch_escrow_detail', 5,
      { release_time: tsToIso(item.escrow_release_time), payout_amount: item.payout_amount },
    );
    return { action: 'enqueued', detailFetched: false };
  }

  // Caso 3 — busca detail inline e faz upsert completo.
  try {
    const resp = await shopeeCallWithRefresh<EscrowDetailResponse>(
      shop,
      '/api/v2/payment/get_escrow_detail',
      { order_sn: item.order_sn },
    );
    await sleep(DETAIL_THROTTLE_MS);

    const response = resp.response;
    if (!response?.order_sn) throw new Error('get_escrow_detail sem order_sn');

    const row = mapEscrowDetailToRow(shop.shop_id, response, response);
    const { error } = await supabase.from('shopee_escrow').upsert(
      {
        ...row,
        escrow_release_time: tsToIso(item.escrow_release_time),
        payout_amount: item.payout_amount ?? null,
        is_released: true,
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id,order_sn' },
    );
    if (error) throw new Error(`UPSERT shopee_escrow (detail): ${error.message}`);
    return { action: 'fetched', detailFetched: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.warn(
      `[shopee-sync][escrow-list] fetch_escrow_detail inline falhou shop_id=${shop.shop_id} order_sn=${item.order_sn}:`,
      msg,
    );
    await upsertReleaseOnly(supabase, shop.shop_id, item);
    await enqueueAction(
      shop.shop_id, 'escrow', item.order_sn, 'fetch_escrow_detail', 5,
      { release_time: tsToIso(item.escrow_release_time), payout_amount: item.payout_amount },
    );
    return { action: 'failed_enqueued', detailFetched: false };
  }
}

async function runOneShop(shop: ActiveShop) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timeLeft = () => MAX_ELAPSED_MS - elapsed();

  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) {
    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: 0,
      details_fetched: 0, updated: 0, enqueued: 0,
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

    let processed = 0;
    let detailsFetched = 0;
    let updated = 0;
    let enqueued = 0;
    let pagesConsumed = 0;
    let moreAfter = false;
    let stoppedReason: StoppedReason = 'complete';

    pageLoop: while (pagesConsumed < MAX_PAGES_PER_RUN) {
      if (timeLeft() < 5000) {
        stoppedReason = 'timeout';
        break;
      }

      const resp = await shopeeCallWithRefresh<EscrowListResp>(
        shop,
        '/api/v2/payment/get_escrow_list',
        {
          release_time_from: windowFromSec,
          release_time_to: windowToSec,
          page_no: pageNo,
          page_size: PAGE_SIZE,
        },
      );
      await sleep(THROTTLE_MS);

      const list = resp.response?.escrow_list ?? [];
      if (list.length === 0) {
        moreAfter = false;
        break;
      }

      // Diagnóstico em um único round-trip: pega escrow_amount para decidir
      // quem já tem detail (IS NOT NULL) e quem precisa.
      const orderSns = list.map(i => i.order_sn);
      const { data: existing } = await supabase
        .from('shopee_escrow')
        .select('order_sn, escrow_amount')
        .eq('shop_id', shop.shop_id)
        .in('order_sn', orderSns);
      const detailMap = new Map<string, boolean>();
      for (const e of existing ?? []) {
        detailMap.set(e.order_sn as string, e.escrow_amount != null);
      }

      for (const item of list) {
        if (timeLeft() < 5000) {
          stoppedReason = 'timeout';
          break pageLoop;
        }

        processed++;
        const result = await processEscrowListItem(
          shop,
          item,
          detailMap.get(item.order_sn) === true,
          detailsFetched < MAX_DETAILS_PER_RUN,
          supabase,
        );
        if (result.detailFetched) detailsFetched++;
        if (result.action === 'updated') updated++;
        else if (result.action === 'enqueued' || result.action === 'failed_enqueued') enqueued++;
      }

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
      `[shopee-sync][escrow-list] shop_id=${shop.shop_id} processed=${processed} details_fetched=${detailsFetched} updated=${updated} enqueued=${enqueued} pages=${pagesConsumed} reason=${stoppedReason}`,
    );

    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed,
      details_fetched: detailsFetched, updated, enqueued,
      duration_ms: elapsed(), stopped_reason: stoppedReason, next_cursor: nextPageStr,
      window: { from: windowFromIso, to: windowToIso },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][escrow-list] shop_id=${shop.shop_id} ERRO:`, msg);
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
      job: JOB_NAME, shop_id: null, processed: 0,
      details_fetched: 0, updated: 0, enqueued: 0,
      duration_ms: 0,
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
