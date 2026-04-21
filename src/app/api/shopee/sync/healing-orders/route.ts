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

// Healing de pedidos — rede de segurança sobre o sync incremental.
// Roda 1x/h: para cada loja ativa, re-puxa pedidos das últimas 72h
// por update_time e UPSERT em shopee_pedidos. Pedidos COMPLETED que
// ainda não têm escrow.escrow_amount são enfileirados como
// fetch_escrow_detail com dedupe_key para evitar duplicação.
//
// NÃO altera estado do sync incremental (sem tocar em checkpoint).
// Orquestração paralela ao job principal.
//
// Ref: SHOPEE_API_REFERENCE.md §3.1.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'healing_orders';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 500;
const WINDOW_HOURS = 72;
const LIST_PAGE_SIZE = 100;
const DETAIL_CHUNK = 50;

const DETAIL_FIELDS = [
  'total_amount', 'pay_time', 'item_list', 'payment_method',
  'shipping_carrier', 'fulfillment_flag', 'estimated_shipping_fee',
  'actual_shipping_fee', 'cod', 'pickup_done_time',
].join(',');

interface OrderListItem { order_sn: string }
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

type SupabaseSrv = ReturnType<typeof createServiceClient>;

// Enqueue com dedupe_key: sem UNIQUE constraint, fazemos check manual.
// Também deduplica por (shop, entity_type, entity_id, action) entre
// PENDING/PROCESSING — mesma semântica do enqueueAction existente.
async function enqueueDedupe(
  supabase: SupabaseSrv,
  shopId: number,
  entityType: string,
  entityId: string,
  action: string,
  priority: number,
  dedupeKey: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('shopee_sync_queue')
    .select('id')
    .eq('shop_id', shopId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('action', action)
    .in('status', ['PENDING', 'PROCESSING'])
    .maybeSingle();
  if (existing) return false;

  const { error } = await supabase.from('shopee_sync_queue').insert({
    shop_id: shopId,
    entity_type: entityType,
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
  orders_read: number;
  inserted: number;
  updated: number;
  enqueued: number;
  pages_fetched: number;
  status: 'success' | 'partial' | 'error';
  error?: string;
}

async function healOneShop(
  shop: ActiveShop,
  timeLeft: () => number,
): Promise<ShopResult> {
  const supabase = createServiceClient();
  const shopStart = Date.now();
  const nowSec = Math.floor(Date.now() / 1000);
  const fromSec = nowSec - WINDOW_HOURS * 3600;
  const windowFromIso = new Date(fromSec * 1000).toISOString();
  const windowToIso = new Date(nowSec * 1000).toISOString();

  const auditId = await startAudit({
    shop_id: shop.shop_id,
    job_name: JOB_NAME,
    window_from: windowFromIso,
    window_to: windowToIso,
  });

  let ordersRead = 0;
  let inserted = 0;
  let updated = 0;
  let enqueued = 0;
  let pagesFetched = 0;
  let status: ShopResult['status'] = 'success';
  let errorMsg: string | undefined;

  try {
    let cursor = '';
    let more = true;

    while (more) {
      if (timeLeft() < 5000) { status = 'partial'; break; }

      const listResp = await shopeeCallWithRefresh<OrderListResp>(
        shop,
        '/api/v2/order/get_order_list',
        {
          time_range_field: 'update_time',
          time_from: fromSec,
          time_to: nowSec,
          page_size: LIST_PAGE_SIZE,
          cursor,
        },
      );
      pagesFetched++;
      await sleep(THROTTLE_MS);

      const snList = (listResp.response?.order_list ?? []).map(o => o.order_sn);
      more = listResp.response?.more === true;
      const nextCursor = listResp.response?.next_cursor || '';

      if (snList.length === 0) break;

      for (let i = 0; i < snList.length; i += DETAIL_CHUNK) {
        if (timeLeft() < 5000) { status = 'partial'; more = false; break; }
        const chunk = snList.slice(i, i + DETAIL_CHUNK);

        const detailResp = await shopeeCallWithRefresh<OrderDetailResp>(
          shop,
          '/api/v2/order/get_order_detail',
          { order_sn_list: chunk.join(','), response_optional_fields: DETAIL_FIELDS },
        );
        await sleep(THROTTLE_MS);

        const items = detailResp.response?.order_list ?? [];
        ordersRead += items.length;
        if (items.length === 0) continue;

        // Contar inserted vs updated: checar quais order_sn já existem.
        const orderSns = items.map(it => it.order_sn);
        const { data: prevRows } = await supabase
          .from('shopee_pedidos')
          .select('order_sn, order_status, complete_time')
          .eq('shop_id', shop.shop_id)
          .in('order_sn', orderSns);
        const prevMap = new Map<string, { order_status: string | null; complete_time: string | null }>();
        for (const p of prevRows ?? []) {
          prevMap.set(p.order_sn as string, {
            order_status: (p.order_status as string | null) ?? null,
            complete_time: (p.complete_time as string | null) ?? null,
          });
        }

        const rows = items.map(item => {
          const prev = prevMap.get(item.order_sn);
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

        const { error: upErr } = await supabase
          .from('shopee_pedidos')
          .upsert(rows, { onConflict: 'shop_id,order_sn' });
        if (upErr) throw new Error(`UPSERT shopee_pedidos: ${upErr.message}`);

        for (const it of items) {
          if (prevMap.has(it.order_sn)) updated++;
          else inserted++;
        }

        // Enfileirar fetch_escrow_detail para COMPLETED sem escrow.escrow_amount.
        const completedSns = items
          .filter(it => it.order_status === 'COMPLETED')
          .map(it => it.order_sn);
        if (completedSns.length > 0) {
          const { data: escrowRows } = await supabase
            .from('shopee_escrow')
            .select('order_sn, escrow_amount')
            .eq('shop_id', shop.shop_id)
            .in('order_sn', completedSns);
          const haveDetail = new Set<string>();
          for (const e of escrowRows ?? []) {
            if (e.escrow_amount != null) haveDetail.add(e.order_sn as string);
          }
          for (const sn of completedSns) {
            if (haveDetail.has(sn)) continue;
            if (timeLeft() < 3000) break;
            const dedupeKey = `fetch_escrow_detail:${shop.shop_id}:${sn}`;
            const created = await enqueueDedupe(
              supabase, shop.shop_id, 'escrow', sn, 'fetch_escrow_detail', 5, dedupeKey,
            );
            if (created) enqueued++;
          }
        }
      }

      cursor = nextCursor;
      if (!cursor) break;
    }
  } catch (err) {
    status = 'error';
    errorMsg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][healing-orders] shop_id=${shop.shop_id} ERRO:`, errorMsg);
  }

  const result: AuditResult = {
    pages_fetched: pagesFetched,
    rows_read: ordersRead,
    rows_inserted: inserted,
    rows_updated: updated,
    rows_enqueued: enqueued,
    errors_count: status === 'error' ? 1 : 0,
    error_message: errorMsg,
  };
  await finishAudit(auditId, status, result, shopStart);

  console.log(
    `[shopee-sync][healing-orders] shop_id=${shop.shop_id} status=${status} read=${ordersRead} ins=${inserted} upd=${updated} enq=${enqueued} pages=${pagesFetched}`,
  );

  return {
    shop_id: shop.shop_id,
    orders_read: ordersRead,
    inserted,
    updated,
    enqueued,
    pages_fetched: pagesFetched,
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
      job: JOB_NAME, shops_processed: 0, total_orders_read: 0,
      total_inserted: 0, total_updated: 0, total_enqueued: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  const shopResults: ShopResult[] = [];
  const pending: number[] = [];
  let totalOrders = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalEnqueued = 0;

  for (const shop of shops) {
    if (timeLeft() < 5000) {
      pending.push(shop.shop_id);
      continue;
    }
    const r = await healOneShop(shop, timeLeft);
    shopResults.push(r);
    totalOrders += r.orders_read;
    totalInserted += r.inserted;
    totalUpdated += r.updated;
    totalEnqueued += r.enqueued;
  }

  if (pending.length > 0) {
    console.warn(`[shopee-sync][healing-orders] tempo esgotado, lojas pendentes: ${pending.join(',')}`);
  }

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: shopResults.length,
    shops_pending: pending,
    total_orders_read: totalOrders,
    total_inserted: totalInserted,
    total_updated: totalUpdated,
    total_enqueued: totalEnqueued,
    per_shop: shopResults,
    duration_ms: Date.now() - startedAt,
  });
}
