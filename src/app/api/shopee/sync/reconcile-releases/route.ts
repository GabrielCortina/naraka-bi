import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getActiveShops, type ActiveShop } from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit, type AuditResult } from '@/lib/shopee/audit';

// Reconcile-releases — fix-wallet-releases automático e permanente.
// Roda 1x/d às 5h BRT (8h UTC): para cada loja ativa, varre todos os
// ESCROW_VERIFIED_ADD da shopee_wallet dos últimos 15 dias e confere
// contra shopee_escrow. Corrige is_released/escrow_release_time/
// payout_amount e enfileira fetch_escrow_detail para stubs novos.
//
// Se divergências > 5% do total scanned: grava flag em metadata.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'reconcile_releases';
const MAX_ELAPSED_MS = 45 * 1000;
const PAGE_SIZE = 1000;
const IN_CHUNK = 500;
const LOOKBACK_DAYS = 15;
const DIVERGENCE_ALERT_RATIO = 0.05;

type SupabaseSrv = ReturnType<typeof createServiceClient>;

async function enqueueDedupe(
  supabase: SupabaseSrv,
  shopId: number,
  entityId: string,
  dedupeKey: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('shopee_sync_queue')
    .select('id')
    .eq('shop_id', shopId)
    .eq('entity_type', 'escrow')
    .eq('entity_id', entityId)
    .eq('action', 'fetch_escrow_detail')
    .in('status', ['PENDING', 'PROCESSING'])
    .maybeSingle();
  if (existing) return false;

  const { error } = await supabase.from('shopee_sync_queue').insert({
    shop_id: shopId,
    entity_type: 'escrow',
    entity_id: entityId,
    action: 'fetch_escrow_detail',
    priority: 5,
    dedupe_key: dedupeKey,
    status: 'PENDING',
    next_retry_at: new Date().toISOString(),
  });
  return !error;
}

interface ShopResult {
  shop_id: number;
  total_checked: number;
  fixed: number;
  stubs_created: number;
  already_ok: number;
  enqueued: number;
  alert: boolean;
  status: 'success' | 'partial' | 'error';
  error?: string;
}

async function reconcileOneShop(
  shop: ActiveShop,
  timeLeft: () => number,
): Promise<ShopResult> {
  const supabase = createServiceClient();
  const shopStart = Date.now();
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  const auditId = await startAudit({
    shop_id: shop.shop_id,
    job_name: JOB_NAME,
    window_from: sinceIso,
    window_to: nowIso,
  });

  let totalChecked = 0;
  let fixed = 0;
  let stubsCreated = 0;
  let alreadyOk = 0;
  let enqueued = 0;
  let status: ShopResult['status'] = 'success';
  let errorMsg: string | undefined;

  try {
    let offset = 0;

    while (timeLeft() > 5000) {
      const { data: walletRows, error: selErr } = await supabase
        .from('shopee_wallet')
        .select('order_sn, create_time, amount')
        .eq('shop_id', shop.shop_id)
        .eq('transaction_type', 'ESCROW_VERIFIED_ADD')
        .gte('create_time', sinceIso)
        .not('order_sn', 'is', null)
        .order('create_time', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (selErr) throw new Error(`SELECT shopee_wallet: ${selErr.message}`);

      if (!walletRows || walletRows.length === 0) break;

      // Dedup por order_sn — primeiro aparecimento é o release mais recente (DESC).
      const byOrderSn = new Map<string, { create_time: string; amount: number | null }>();
      for (const w of walletRows) {
        const sn = w.order_sn as string;
        if (!byOrderSn.has(sn)) {
          byOrderSn.set(sn, {
            create_time: w.create_time as string,
            amount: (w.amount as number | null) ?? null,
          });
        }
      }
      const orderSns = Array.from(byOrderSn.keys());
      totalChecked += orderSns.length;

      const escrowMap = new Map<string, { is_released: boolean; escrow_release_time: string | null }>();
      for (let i = 0; i < orderSns.length; i += IN_CHUNK) {
        const slice = orderSns.slice(i, i + IN_CHUNK);
        const { data: rows } = await supabase
          .from('shopee_escrow')
          .select('order_sn, is_released, escrow_release_time')
          .eq('shop_id', shop.shop_id)
          .in('order_sn', slice);
        for (const r of rows ?? []) {
          escrowMap.set(r.order_sn as string, {
            is_released: (r.is_released as boolean | null) ?? false,
            escrow_release_time: (r.escrow_release_time as string | null) ?? null,
          });
        }
      }

      const rowsToUpsert: Array<{
        shop_id: number; order_sn: string; is_released: boolean;
        escrow_release_time: string; payout_amount: number | null; synced_at: string;
      }> = [];
      const newSns: string[] = [];

      for (const [sn, info] of Array.from(byOrderSn.entries())) {
        const ex = escrowMap.get(sn);
        if (!ex) {
          rowsToUpsert.push({
            shop_id: shop.shop_id, order_sn: sn, is_released: true,
            escrow_release_time: info.create_time, payout_amount: info.amount,
            synced_at: nowIso,
          });
          newSns.push(sn);
          stubsCreated++;
        } else if (!ex.is_released || !ex.escrow_release_time) {
          rowsToUpsert.push({
            shop_id: shop.shop_id, order_sn: sn, is_released: true,
            escrow_release_time: info.create_time, payout_amount: info.amount,
            synced_at: nowIso,
          });
          fixed++;
        } else {
          alreadyOk++;
        }
      }

      const UP_CHUNK = 500;
      for (let i = 0; i < rowsToUpsert.length; i += UP_CHUNK) {
        const slice = rowsToUpsert.slice(i, i + UP_CHUNK);
        const { error: upErr } = await supabase
          .from('shopee_escrow')
          .upsert(slice, { onConflict: 'shop_id,order_sn' });
        if (upErr) throw new Error(`UPSERT shopee_escrow: ${upErr.message}`);
      }

      for (const sn of newSns) {
        if (timeLeft() < 3000) break;
        const dedupeKey = `fetch_escrow_detail:${shop.shop_id}:${sn}`;
        const created = await enqueueDedupe(supabase, shop.shop_id, sn, dedupeKey);
        if (created) enqueued++;
      }

      if (walletRows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (timeLeft() < 5000) { status = 'partial'; break; }
    }
  } catch (err) {
    status = 'error';
    errorMsg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][reconcile-releases] shop_id=${shop.shop_id} ERRO:`, errorMsg);
  }

  const divergences = fixed + stubsCreated;
  const alert = totalChecked > 0 && divergences / totalChecked > DIVERGENCE_ALERT_RATIO;

  const result: AuditResult = {
    rows_read: totalChecked,
    rows_updated: fixed,
    rows_inserted: stubsCreated,
    rows_enqueued: enqueued,
    errors_count: status === 'error' ? 1 : 0,
    error_message: errorMsg,
    metadata: {
      already_ok: alreadyOk,
      divergences,
      divergence_ratio: totalChecked > 0 ? divergences / totalChecked : 0,
      alert,
    },
  };
  await finishAudit(auditId, status, result, shopStart);

  console.log(
    `[shopee-sync][reconcile-releases] shop_id=${shop.shop_id} status=${status} checked=${totalChecked} fixed=${fixed} stubs=${stubsCreated} ok=${alreadyOk} alert=${alert}`,
  );

  return {
    shop_id: shop.shop_id,
    total_checked: totalChecked,
    fixed,
    stubs_created: stubsCreated,
    already_ok: alreadyOk,
    enqueued,
    alert,
    status,
    error: errorMsg,
  };
}

export async function GET() {
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const shops = await getActiveShops();
  if (shops.length === 0) {
    return NextResponse.json({
      job: JOB_NAME, shops_processed: 0, total_checked: 0,
      fixed: 0, stubs_created: 0, already_ok: 0, alerts: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  const shopResults: ShopResult[] = [];
  const pending: number[] = [];
  let totalChecked = 0;
  let fixedTotal = 0;
  let stubsTotal = 0;
  let alreadyOkTotal = 0;
  let alertsTotal = 0;

  for (const shop of shops) {
    if (timeLeft() < 5000) {
      pending.push(shop.shop_id);
      continue;
    }
    const r = await reconcileOneShop(shop, timeLeft);
    shopResults.push(r);
    totalChecked += r.total_checked;
    fixedTotal += r.fixed;
    stubsTotal += r.stubs_created;
    alreadyOkTotal += r.already_ok;
    if (r.alert) alertsTotal++;
  }

  if (pending.length > 0) {
    console.warn(`[shopee-sync][reconcile-releases] tempo esgotado, lojas pendentes: ${pending.join(',')}`);
  }

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: shopResults.length,
    shops_pending: pending,
    total_checked: totalChecked,
    fixed: fixedTotal,
    stubs_created: stubsTotal,
    already_ok: alreadyOkTotal,
    alerts: alertsTotal,
    per_shop: shopResults,
    duration_ms: Date.now() - startedAt,
  });
}
