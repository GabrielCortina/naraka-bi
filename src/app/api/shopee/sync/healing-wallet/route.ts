import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getActiveShops,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit, type AuditResult } from '@/lib/shopee/audit';

// Healing de wallet — rede de segurança sobre o sync incremental.
// Roda 1x/d às 4h BRT (7h UTC): para cada loja ativa, re-puxa a wallet
// dos últimos 7 dias (1 janela só — 7 <= limite da API ~15 dias),
// UPSERT em shopee_wallet e marca is_released=true nos escrows
// correspondentes aos ESCROW_VERIFIED_ADD.
//
// Se o escrow não existe ainda, cria stub e enfileira fetch_escrow_detail
// (dedupe_key para não duplicar).
//
// Ref: SHOPEE_API_REFERENCE.md §3.2.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'healing_wallet';
const MAX_ELAPSED_MS = 45 * 1000;
const PER_SHOP_MAX_MS = 45 * 1000;
const THROTTLE_MS = 500;
const PAGE_SIZE = 100;
const WINDOW_DAYS = 7;

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

type SupabaseSrv = ReturnType<typeof createServiceClient>;

async function enqueueDedupe(
  supabase: SupabaseSrv,
  shopId: number,
  entityId: string,
  action: string,
  priority: number,
  dedupeKey: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('shopee_sync_queue')
    .select('id')
    .eq('shop_id', shopId)
    .eq('entity_type', 'escrow')
    .eq('entity_id', entityId)
    .eq('action', action)
    .in('status', ['PENDING', 'PROCESSING'])
    .maybeSingle();
  if (existing) return false;

  const { error } = await supabase.from('shopee_sync_queue').insert({
    shop_id: shopId,
    entity_type: 'escrow',
    entity_id: entityId,
    action,
    priority,
    dedupe_key: dedupeKey,
    status: 'PENDING',
    next_retry_at: new Date().toISOString(),
  });
  return !error;
}

interface ShopResult {
  shop_id: number;
  total_fetched: number;
  new_inserted: number;
  already_existed: number;
  releases_fixed: number;
  stubs_created: number;
  pages_fetched: number;
  status: 'success' | 'partial' | 'error';
  error?: string;
}

async function healOneShop(
  shop: ActiveShop,
  globalTimeLeft: () => number,
): Promise<ShopResult> {
  const supabase = createServiceClient();
  const shopStart = Date.now();
  const shopTimeLeft = () => Math.min(globalTimeLeft(), PER_SHOP_MAX_MS - (Date.now() - shopStart));

  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - WINDOW_DAYS * 86400;
  const windowFromIso = new Date(fromSec * 1000).toISOString();
  const windowToIso = new Date(nowSec * 1000).toISOString();

  const auditId = await startAudit({
    shop_id: shop.shop_id,
    job_name: JOB_NAME,
    window_from: windowFromIso,
    window_to: windowToIso,
  });

  let totalFetched = 0;
  let newInserted = 0;
  let alreadyExisted = 0;
  let releasesFixed = 0;
  let stubsCreated = 0;
  let pagesFetched = 0;
  let status: ShopResult['status'] = 'success';
  let errorMsg: string | undefined;

  try {
    let pageNo = 1;
    let more = true;

    while (more) {
      if (shopTimeLeft() < 5000) { status = 'partial'; break; }

      const resp = await shopeeCallWithRefresh<WalletResp>(
        shop,
        '/api/v2/payment/get_wallet_transaction_list',
        {
          page_no: pageNo,
          page_size: PAGE_SIZE,
          create_time_from: fromSec,
          create_time_to: nowSec,
        },
      );
      pagesFetched++;
      more = resp.response?.more === true;

      const txns = (resp.response?.transaction_list ?? []).filter(
        t => t.transaction_id != null && t.create_time != null,
      );

      if (txns.length > 0) {
        const txnIds = txns.map(t => t.transaction_id!);
        const { data: existing } = await supabase
          .from('shopee_wallet')
          .select('transaction_id')
          .eq('shop_id', shop.shop_id)
          .in('transaction_id', txnIds);
        const existingIds = new Set<number>(
          (existing ?? []).map(r => r.transaction_id as number),
        );

        const nowIso = new Date().toISOString();
        const rows = txns.map(t => ({
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
          synced_at: nowIso,
        }));

        const { error: upErr } = await supabase
          .from('shopee_wallet')
          .upsert(rows, { onConflict: 'shop_id,transaction_id' });
        if (upErr) throw new Error(`UPSERT shopee_wallet: ${upErr.message}`);

        totalFetched += txns.length;
        for (const t of txns) {
          if (existingIds.has(t.transaction_id!)) alreadyExisted++;
          else newInserted++;
        }

        // ESCROW_VERIFIED_ADD → reconciliar com shopee_escrow.
        const releaseTxns = txns.filter(
          t => t.transaction_type === 'ESCROW_VERIFIED_ADD' && t.order_sn,
        );
        if (releaseTxns.length > 0) {
          const releaseBySn = new Map<string, WalletTxn>();
          for (const t of releaseTxns) {
            const prev = releaseBySn.get(t.order_sn!);
            if (!prev || (t.create_time ?? 0) > (prev.create_time ?? 0)) {
              releaseBySn.set(t.order_sn!, t);
            }
          }
          const uniqSns = Array.from(releaseBySn.keys());

          const { data: existingEscrows } = await supabase
            .from('shopee_escrow')
            .select('order_sn, is_released, escrow_release_time')
            .eq('shop_id', shop.shop_id)
            .in('order_sn', uniqSns);
          const existingMap = new Map<string, { is_released: boolean; escrow_release_time: string | null }>();
          for (const e of existingEscrows ?? []) {
            existingMap.set(e.order_sn as string, {
              is_released: (e.is_released as boolean | null) ?? false,
              escrow_release_time: (e.escrow_release_time as string | null) ?? null,
            });
          }

          const rowsToUpsert: Array<{
            shop_id: number; order_sn: string; is_released: boolean;
            escrow_release_time: string | null; payout_amount: number | null; synced_at: string;
          }> = [];
          const newSns: string[] = [];

          for (const [orderSn, txn] of Array.from(releaseBySn.entries())) {
            const ex = existingMap.get(orderSn);
            const needs = !ex || !ex.is_released || !ex.escrow_release_time;
            if (!needs) continue;
            rowsToUpsert.push({
              shop_id: shop.shop_id,
              order_sn: orderSn,
              is_released: true,
              escrow_release_time: tsToIso(txn.create_time!),
              payout_amount: txn.amount ?? null,
              synced_at: nowIso,
            });
            if (!ex) newSns.push(orderSn);
            else releasesFixed++;
          }

          if (rowsToUpsert.length > 0) {
            const { error: escErr } = await supabase
              .from('shopee_escrow')
              .upsert(rowsToUpsert, { onConflict: 'shop_id,order_sn' });
            if (escErr) throw new Error(`UPSERT shopee_escrow: ${escErr.message}`);
          }

          stubsCreated += newSns.length;
          for (const sn of newSns) {
            if (shopTimeLeft() < 3000) break;
            const dedupeKey = `fetch_escrow_detail:${shop.shop_id}:${sn}`;
            await enqueueDedupe(supabase, shop.shop_id, sn, 'fetch_escrow_detail', 5, dedupeKey);
          }
        }
      }

      if (!more) break;
      pageNo++;
      await sleep(THROTTLE_MS);
    }
  } catch (err) {
    status = 'error';
    errorMsg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][healing-wallet] shop_id=${shop.shop_id} ERRO:`, errorMsg);
  }

  const result: AuditResult = {
    pages_fetched: pagesFetched,
    rows_read: totalFetched,
    rows_inserted: newInserted,
    rows_updated: releasesFixed,
    rows_enqueued: stubsCreated,
    errors_count: status === 'error' ? 1 : 0,
    error_message: errorMsg,
    metadata: { already_existed: alreadyExisted },
  };
  await finishAudit(auditId, status, result, shopStart);

  console.log(
    `[shopee-sync][healing-wallet] shop_id=${shop.shop_id} status=${status} fetched=${totalFetched} new=${newInserted} existed=${alreadyExisted} released=${releasesFixed} stubs=${stubsCreated}`,
  );

  return {
    shop_id: shop.shop_id,
    total_fetched: totalFetched,
    new_inserted: newInserted,
    already_existed: alreadyExisted,
    releases_fixed: releasesFixed,
    stubs_created: stubsCreated,
    pages_fetched: pagesFetched,
    status,
    error: errorMsg,
  };
}

export async function GET() {
  const startedAt = Date.now();
  const globalTimeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const shops = await getActiveShops();
  if (shops.length === 0) {
    return NextResponse.json({
      job: JOB_NAME, shops_processed: 0, total_fetched: 0,
      new_inserted: 0, already_existed: 0, releases_fixed: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  const shopResults: ShopResult[] = [];
  const pending: number[] = [];
  let totalFetched = 0;
  let newInserted = 0;
  let alreadyExisted = 0;
  let releasesFixed = 0;

  for (const shop of shops) {
    if (globalTimeLeft() < 5000) {
      pending.push(shop.shop_id);
      continue;
    }
    const r = await healOneShop(shop, globalTimeLeft);
    shopResults.push(r);
    totalFetched += r.total_fetched;
    newInserted += r.new_inserted;
    alreadyExisted += r.already_existed;
    releasesFixed += r.releases_fixed;
  }

  if (pending.length > 0) {
    console.warn(`[shopee-sync][healing-wallet] tempo esgotado, lojas pendentes: ${pending.join(',')}`);
  }

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: shopResults.length,
    shops_pending: pending,
    total_fetched: totalFetched,
    new_inserted: newInserted,
    already_existed: alreadyExisted,
    releases_fixed: releasesFixed,
    per_shop: shopResults,
    duration_ms: Date.now() - startedAt,
  });
}
