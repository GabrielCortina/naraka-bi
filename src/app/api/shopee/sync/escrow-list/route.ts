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

// Sync de escrow list (liberações). Preenche escrow_release_time + payout_amount +
// is_released na tabela shopee_escrow. Se o escrow ainda não existe no banco,
// enfileira fetch_escrow_detail.
// Ref: SHOPEE_API_REFERENCE.md §3.2 — janela MAX 30 dias.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const JOB_NAME = 'sync_escrow_list';
const THROTTLE_MS = 500;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 30;
const WINDOW_MAX_DAYS = 30;
const PAGE_SIZE = 100;

interface EscrowListItem {
  order_sn: string;
  payout_amount?: number;
  escrow_release_time?: number;
}
interface EscrowListResp {
  more?: boolean;
  escrow_list?: EscrowListItem[];
}

interface ShopResult {
  shop_id: number;
  releases?: number;
  enqueued?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

async function syncOneShop(shop: ActiveShop): Promise<ShopResult> {
  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) {
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
      fromSec = nowSec - BACKFILL_DAYS * 86400;
    }

    let totalReleases = 0;
    let totalEnqueued = 0;
    let windowFrom = fromSec;

    while (windowFrom < nowSec) {
      const windowTo = Math.min(windowFrom + WINDOW_MAX_DAYS * 86400, nowSec);
      let pageNo = 1;

      while (true) {
        const resp = await shopeeCallWithRefresh<EscrowListResp>(
          shop,
          '/api/v2/payment/get_escrow_list',
          {
            release_time_from: windowFrom,
            release_time_to: windowTo,
            page_no: pageNo,
            page_size: PAGE_SIZE,
          },
        );
        await sleep(THROTTLE_MS);

        const list = resp.response?.escrow_list ?? [];
        if (list.length === 0) break;

        const orderSns = list.map(i => i.order_sn);
        const { data: existing } = await supabase
          .from('shopee_escrow')
          .select('order_sn')
          .eq('shop_id', shop.shop_id)
          .in('order_sn', orderSns);
        const existingSet = new Set((existing ?? []).map(e => e.order_sn as string));

        for (const item of list) {
          const releaseIso = tsToIso(item.escrow_release_time);
          if (existingSet.has(item.order_sn)) {
            const { error } = await supabase
              .from('shopee_escrow')
              .update({
                escrow_release_time: releaseIso,
                payout_amount: item.payout_amount ?? null,
                is_released: true,
              })
              .eq('shop_id', shop.shop_id)
              .eq('order_sn', item.order_sn);
            if (error) {
              console.error(
                `[shopee-sync][escrow-list] UPDATE falhou ${item.order_sn}:`,
                error.message,
              );
              continue;
            }
            totalReleases++;
          } else {
            const created = await enqueueAction(
              shop.shop_id,
              'escrow',
              item.order_sn,
              'fetch_escrow_detail',
              3,
              { release_time: releaseIso, payout_amount: item.payout_amount },
            );
            if (created) totalEnqueued++;
          }
        }

        if (!resp.response?.more) break;
        pageNo++;
      }

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
      `[shopee-sync][escrow-list] shop_id=${shop.shop_id} releases=${totalReleases} enfileirados=${totalEnqueued}`,
    );
    return { shop_id: shop.shop_id, releases: totalReleases, enqueued: totalEnqueued };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][escrow-list] shop_id=${shop.shop_id} ERRO:`, msg);
    await updateCheckpoint(shop.shop_id, JOB_NAME, {
      last_error_at: new Date().toISOString(),
      last_error_message: msg,
      is_running: false,
    });
    return { shop_id: shop.shop_id, error: msg };
  }
}

export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const all = await getActiveShops();
  const target = shopIdRaw ? all.filter(s => s.shop_id === Number(shopIdRaw)) : all;

  if (target.length === 0) {
    return NextResponse.json({ error: 'Nenhuma loja ativa' }, { status: 404 });
  }

  const results: ShopResult[] = [];
  for (const shop of target) results.push(await syncOneShop(shop));

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: results.length,
    releases: results.reduce((s, r) => s + (r.releases ?? 0), 0),
    enqueued: results.reduce((s, r) => s + (r.enqueued ?? 0), 0),
    errors: results.filter(r => r.error).length,
    results,
  });
}
