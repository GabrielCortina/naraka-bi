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

// Sync de wallet transactions. Janela max 14 dias (limite 15 da Shopee,
// margem de segurança). Opcionalmente marca shopee_escrow.is_released=true
// para ESCROW_VERIFIED_ADD com order_sn (confirmação via wallet).
// Ref: SHOPEE_API_REFERENCE.md §3.2 — enum transaction_type.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

const JOB_NAME = 'sync_wallet';
const THROTTLE_MS = 500;
const WINDOW_OVERLAP_SEC = 5 * 60;
const BACKFILL_DAYS = 14;
const WINDOW_MAX_DAYS = 14;
const PAGE_SIZE = 100;

// Mapa transaction_type → código (ver SHOPEE_API_REFERENCE.md §3.2).
const TYPE_CODE: Record<string, number> = {
  ESCROW_VERIFIED_ADD: 101,
  ESCROW_VERIFIED_MINUS: 102,
  WITHDRAWAL_CREATED: 201,
  WITHDRAWAL_COMPLETED: 202,
  WITHDRAWAL_CANCELLED: 203,
  ADJUSTMENT_ADD: 401,
  ADJUSTMENT_MINUS: 402,
  FBS_ADJUSTMENT_ADD: 404,
  FBS_ADJUSTMENT_MINUS: 405,
  ADJUSTMENT_CENTER_ADD: 406,
  ADJUSTMENT_CENTER_DEDUCT: 407,
  FSF_COST_PASSING_DEDUCT: 408,
  PERCEPTION_VAT_TAX_DEDUCT: 409,
  PERCEPTION_TURNOVER_TAX_DEDUCT: 410,
  PAID_ADS: 450,
  PAID_ADS_REFUND: 451,
  FAST_ESCROW_DISBURSE: 452,
  AFFILIATE_ADS_SELLER_FEE: 455,
  AFFILIATE_ADS_SELLER_FEE_REFUND: 456,
  FAST_ESCROW_DEDUCT: 458,
  FAST_ESCROW_DISBURSE_REMAIN: 459,
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
interface WalletResp {
  more?: boolean;
  transaction_list?: WalletTxn[];
}

interface ShopResult {
  shop_id: number;
  transactions?: number;
  released_marked?: number;
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

    let totalTxns = 0;
    let releasedMarked = 0;
    let windowFrom = fromSec;

    while (windowFrom < nowSec) {
      const windowTo = Math.min(windowFrom + WINDOW_MAX_DAYS * 86400, nowSec);
      let pageNo = 1;

      while (true) {
        const resp = await shopeeCallWithRefresh<WalletResp>(
          shop,
          '/api/v2/payment/get_wallet_transaction_list',
          {
            page_no: pageNo,
            page_size: PAGE_SIZE,
            create_time_from: windowFrom,
            create_time_to: windowTo,
          },
        );
        await sleep(THROTTLE_MS);

        const txns = resp.response?.transaction_list ?? [];
        if (txns.length === 0) break;

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

        // Confirmação de release: ESCROW_VERIFIED_ADD com order_sn
        const releaseSns = txns
          .filter(t => t.transaction_type === 'ESCROW_VERIFIED_ADD' && t.order_sn)
          .map(t => t.order_sn!);
        if (releaseSns.length > 0) {
          const { data: updated } = await supabase
            .from('shopee_escrow')
            .update({ is_released: true })
            .eq('shop_id', shop.shop_id)
            .in('order_sn', releaseSns)
            .eq('is_released', false)
            .select('order_sn');
          releasedMarked += updated?.length ?? 0;
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
      `[shopee-sync][wallet] shop_id=${shop.shop_id} txns=${totalTxns} released_marked=${releasedMarked}`,
    );
    return { shop_id: shop.shop_id, transactions: totalTxns, released_marked: releasedMarked };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][wallet] shop_id=${shop.shop_id} ERRO:`, msg);
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
    transactions: results.reduce((s, r) => s + (r.transactions ?? 0), 0),
    released_marked: results.reduce((s, r) => s + (r.released_marked ?? 0), 0),
    errors: results.filter(r => r.error).length,
    results,
  });
}
