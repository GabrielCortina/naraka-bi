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

// Sync incremental de wallet. Uma loja + até MAX_PAGES páginas por execução.
// Janela MAX 14 dias (limite Shopee ~15d, margem de segurança).
// Ref: SHOPEE_API_REFERENCE.md §3.2 — enum transaction_type.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_wallet';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 400;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 14;
const WINDOW_MAX_DAYS = 14;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 10;

const TYPE_CODE: Record<string, number> = {
  ESCROW_VERIFIED_ADD: 101, ESCROW_VERIFIED_MINUS: 102,
  WITHDRAWAL_CREATED: 201, WITHDRAWAL_COMPLETED: 202, WITHDRAWAL_CANCELLED: 203,
  ADJUSTMENT_ADD: 401, ADJUSTMENT_MINUS: 402,
  FBS_ADJUSTMENT_ADD: 404, FBS_ADJUSTMENT_MINUS: 405,
  ADJUSTMENT_CENTER_ADD: 406, ADJUSTMENT_CENTER_DEDUCT: 407,
  FSF_COST_PASSING_DEDUCT: 408,
  PERCEPTION_VAT_TAX_DEDUCT: 409, PERCEPTION_TURNOVER_TAX_DEDUCT: 410,
  PAID_ADS: 450, PAID_ADS_REFUND: 451,
  FAST_ESCROW_DISBURSE: 452,
  AFFILIATE_ADS_SELLER_FEE: 455, AFFILIATE_ADS_SELLER_FEE_REFUND: 456,
  FAST_ESCROW_DEDUCT: 458, FAST_ESCROW_DISBURSE_REMAIN: 459,
  AFFILIATE_FEE_DEDUCT: 460,
};

interface WalletTxn {
  transaction_id?: number;
  transaction_type?: string;
  status?: string;
  amount?: number;
  current_balance?: number;
  create_time?: number;
  order_sn?: string;
  refund_sn?: string;
  description?: string;
  buyer_name?: string;
  money_flow?: string;
  wallet_type?: string;
  transaction_tab_type?: string;
  withdrawal_id?: number;
  reason?: string;
}
interface WalletResp { more?: boolean; transaction_list?: WalletTxn[] }

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

    let totalTxns = 0;
    let releasedMarked = 0;
    let stubsCreated = 0;
    let stubsEnqueued = 0;
    let pagesConsumed = 0;
    let moreAfter = false;
    let stoppedReason: StoppedReason = 'complete';

    while (pagesConsumed < MAX_PAGES_PER_RUN) {
      if (timeLeft() < 5000) { stoppedReason = 'timeout'; break; }

      const resp = await shopeeCallWithRefresh<WalletResp>(
        shop,
        '/api/v2/payment/get_wallet_transaction_list',
        {
          page_no: pageNo,
          page_size: PAGE_SIZE,
          create_time_from: windowFromSec,
          create_time_to: windowToSec,
        },
      );
      await sleep(THROTTLE_MS);

      const txns = resp.response?.transaction_list ?? [];
      if (txns.length === 0) { moreAfter = false; break; }

      const rows = txns
        .filter(t => t.transaction_id != null && t.create_time != null)
        .map(t => ({
          shop_id: shop.shop_id,
          transaction_id: t.transaction_id!,
          transaction_type: t.transaction_type ?? 'UNKNOWN',
          transaction_type_code: t.transaction_type ? TYPE_CODE[t.transaction_type] ?? null : null,
          status: t.status ?? null,
          amount: t.amount ?? 0,
          current_balance: t.current_balance ?? null,
          order_sn: t.order_sn || null,
          refund_sn: t.refund_sn || null,
          description: t.description ?? null,
          buyer_name: t.buyer_name ?? null,
          money_flow: t.money_flow ?? null,
          wallet_type: t.wallet_type ?? null,
          transaction_tab_type: t.transaction_tab_type ?? null,
          withdrawal_id: t.withdrawal_id ?? null,
          reason: t.reason ?? null,
          create_time: tsToIso(t.create_time!)!,
          synced_at: new Date().toISOString(),
        }));

      if (rows.length > 0) {
        const { error } = await supabase
          .from('shopee_wallet')
          .upsert(rows, { onConflict: 'shop_id,transaction_id' });
        if (error) throw new Error(`UPSERT shopee_wallet: ${error.message}`);
      }
      totalTxns += rows.length;

      // ESCROW_VERIFIED_ADD é autoritativo para "o dinheiro caiu". Usamos
      // create_time como escrow_release_time e amount como payout_amount.
      // Se o escrow ainda não existe (get_escrow_list perdeu), inserimos um
      // stub e enfileiramos fetch_escrow_detail para trazer o breakdown.
      const releaseTxns = txns.filter(
        t => t.transaction_type === 'ESCROW_VERIFIED_ADD' && t.order_sn && t.create_time != null,
      );
      if (releaseTxns.length > 0) {
        // Dedup por order_sn — guarda o mais recente caso haja duplicatas.
        const releaseBySn = new Map<string, WalletTxn>();
        for (const t of releaseTxns) {
          const prev = releaseBySn.get(t.order_sn!);
          if (!prev || (t.create_time ?? 0) > (prev.create_time ?? 0)) {
            releaseBySn.set(t.order_sn!, t);
          }
        }
        const uniqSns = Array.from(releaseBySn.keys());

        const { data: existingRows } = await supabase
          .from('shopee_escrow')
          .select('order_sn, is_released, escrow_release_time')
          .eq('shop_id', shop.shop_id)
          .in('order_sn', uniqSns);
        const existingMap = new Map<string, { is_released: boolean; escrow_release_time: string | null }>();
        for (const e of existingRows ?? []) {
          existingMap.set(e.order_sn as string, {
            is_released: (e.is_released as boolean | null) ?? false,
            escrow_release_time: (e.escrow_release_time as string | null) ?? null,
          });
        }

        const nowIso = new Date().toISOString();
        const rowsToUpsert: Array<{
          shop_id: number; order_sn: string; is_released: boolean;
          escrow_release_time: string | null; payout_amount: number | null;
          synced_at: string;
        }> = [];
        const newSns: string[] = [];

        for (const [orderSn, txn] of Array.from(releaseBySn.entries())) {
          const ex = existingMap.get(orderSn);
          const needsRelease = !ex || !ex.is_released || !ex.escrow_release_time;
          if (!needsRelease) continue;

          rowsToUpsert.push({
            shop_id: shop.shop_id,
            order_sn: orderSn,
            is_released: true,
            escrow_release_time: tsToIso(txn.create_time!),
            payout_amount: txn.amount ?? null,
            synced_at: nowIso,
          });
          if (!ex) newSns.push(orderSn);
          else releasedMarked++;
        }

        if (rowsToUpsert.length > 0) {
          // Upsert só mexe nas colunas presentes no payload — linhas com
          // detail já preenchido mantêm os campos finos intocados.
          const { error: upErr } = await supabase
            .from('shopee_escrow')
            .upsert(rowsToUpsert, { onConflict: 'shop_id,order_sn' });
          if (upErr) throw new Error(`UPSERT shopee_escrow (release via wallet): ${upErr.message}`);
        }

        stubsCreated += newSns.length;
        for (const sn of newSns) {
          const ok = await enqueueAction(shop.shop_id, 'escrow', sn, 'fetch_escrow_detail', 5);
          if (ok) stubsEnqueued++;
        }
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
      `[shopee-sync][wallet] shop_id=${shop.shop_id} txns=${totalTxns} released=${releasedMarked} stubs_created=${stubsCreated} stubs_enqueued=${stubsEnqueued} pages=${pagesConsumed} reason=${stoppedReason}`,
    );

    return {
      job: JOB_NAME, shop_id: shop.shop_id,
      processed: totalTxns,
      released_marked: releasedMarked,
      stubs_created: stubsCreated,
      stubs_enqueued: stubsEnqueued,
      duration_ms: elapsed(), stopped_reason: stoppedReason, next_cursor: nextPageStr,
      window: { from: windowFromIso, to: windowToIso },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][wallet] shop_id=${shop.shop_id} ERRO:`, msg);
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
