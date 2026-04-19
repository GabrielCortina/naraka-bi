import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getActiveShops,
  lockCheckpoint,
  updateCheckpoint,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync de returns. Janela max 14 dias. get_return_list é paginado por
// page_no. Enriquecimento via get_return_detail fica sob demanda (worker).
// Ref: SHOPEE_API_REFERENCE.md §3.3.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const JOB_NAME = 'sync_returns';
const THROTTLE_MS = 500;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 14;
const WINDOW_MAX_DAYS = 14;
const PAGE_SIZE = 20;

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
interface ReturnListResp {
  more?: boolean;
  return?: ReturnItem[];
}

interface ShopResult {
  shop_id: number;
  returns?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

async function syncOneShop(shop: ActiveShop): Promise<ShopResult> {
  const acquired = await lockCheckpoint(shop.shop_id, JOB_NAME);
  if (!acquired) return { shop_id: shop.shop_id, skipped: true, reason: 'already_running' };

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

    let totalReturns = 0;
    let windowFrom = fromSec;

    while (windowFrom < nowSec) {
      const windowTo = Math.min(windowFrom + WINDOW_MAX_DAYS * 86400, nowSec);
      let pageNo = 1;

      while (true) {
        const resp = await shopeeCallWithRefresh<ReturnListResp>(
          shop,
          '/api/v2/returns/get_return_list',
          {
            page_no: pageNo,
            page_size: PAGE_SIZE,
            create_time_from: windowFrom,
            create_time_to: windowTo,
          },
        );
        await sleep(THROTTLE_MS);

        const items = resp.response?.return ?? [];
        if (items.length === 0) break;

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

    console.log(`[shopee-sync][returns] shop_id=${shop.shop_id} returns=${totalReturns}`);
    return { shop_id: shop.shop_id, returns: totalReturns };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][returns] shop_id=${shop.shop_id} ERRO:`, msg);
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
  if (target.length === 0) return NextResponse.json({ error: 'Nenhuma loja ativa' }, { status: 404 });

  const results: ShopResult[] = [];
  for (const shop of target) results.push(await syncOneShop(shop));

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: results.length,
    returns: results.reduce((s, r) => s + (r.returns ?? 0), 0),
    errors: results.filter(r => r.error).length,
    results,
  });
}
