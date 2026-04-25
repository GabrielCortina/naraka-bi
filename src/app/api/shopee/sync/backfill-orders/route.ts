import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getShopById,
  shopeeCallWithRefresh,
  enqueueAction,
  sleep,
  tsToIso,
} from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit, type AuditResult } from '@/lib/shopee/audit';

// Backfill de pedidos por janela arbitrária — repopula shopee_pedidos
// percorrendo dia-a-dia (UTC) de `to` até `from`, mais recente → mais antigo.
//
// Diferenças vs sync/orders e healing-orders:
//   - Sem checkpoint: o incremental continua intocado, este job é one-shot
//     e idempotente (UPSERT por shop_id+order_sn).
//   - Janela controlada pelo caller (FROM/TO em YYYY-MM-DD), não pelo cron.
//   - time_range_field = 'create_time' (não update_time): queremos pedidos
//     CRIADOS no período histórico, independente de updates posteriores.
//
// Se o budget de 45s estourar, devolvemos `stopped_date` — basta chamar
// novamente com `from=stopped_date` pra continuar de onde parou.
//
// Ref: SHOPEE_API_REFERENCE.md §3.1.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Vercel Pro: até 300s. Com volume da Joy, 55s não cobre nem 1 dia.
// Buffer de ~10s no MAX_ELAPSED_MS pra fechar audit/UPSERT antes do kill do runtime.
export const maxDuration = 300;

const JOB_NAME = 'backfill_orders';
const MAX_ELAPSED_MS = 290 * 1000;
const THROTTLE_MS = 200;
const LIST_PAGE_SIZE = 100;
const DETAIL_CHUNK = 50;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

// Limites UTC de um dia ISO (YYYY-MM-DD).
function dayBoundsUtc(dateStr: string): { from: number; to: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const endMs = Date.UTC(y, m - 1, d, 23, 59, 59, 0);
  return { from: Math.floor(startMs / 1000), to: Math.floor(endMs / 1000) };
}

// Lista os dias entre from..to (inclusive) em ordem DECRESCENTE (mais recente primeiro).
function listDaysDescending(from: string, to: string): string[] {
  const out: string[] = [];
  const [yT, mT, dT] = to.split('-').map(Number);
  const [yF, mF, dF] = from.split('-').map(Number);
  const startMs = Date.UTC(yT, mT - 1, dT);
  const endMs = Date.UTC(yF, mF - 1, dF);
  for (let ms = startMs; ms >= endMs; ms -= 86400_000) {
    const d = new Date(ms);
    const ds = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push(ds);
  }
  return out;
}

interface DayStats {
  date: string;
  orders: number;
  inserted: number;
  updated: number;
  enqueued: number;
  pages: number;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timeLeft = () => MAX_ELAPSED_MS - elapsed();

  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (!shopIdRaw || !from || !to) {
    return NextResponse.json(
      { error: 'shop_id, from e to são obrigatórios (from/to em YYYY-MM-DD)' },
      { status: 400 },
    );
  }
  const shopId = Number(shopIdRaw);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ error: 'from/to devem ser YYYY-MM-DD' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'from deve ser ≤ to' }, { status: 400 });
  }

  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json(
      { error: `loja ${shopId} não está em shopee_tokens (ou is_active=false)` },
      { status: 404 },
    );
  }

  const supabase = createServiceClient();
  const days = listDaysDescending(from, to);

  const auditId = await startAudit({
    shop_id: shopId,
    job_name: JOB_NAME,
    window_from: `${from}T00:00:00Z`,
    window_to: `${to}T23:59:59Z`,
  });

  const daysProcessed: DayStats[] = [];
  const daysPending: string[] = [];
  let totalOrders = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalEnqueued = 0;
  let totalPages = 0;
  let stoppedDate: string | null = null;
  let errorMsg: string | undefined;

  try {
    for (const date of days) {
      // Reserva 5s por dia pra encerrar com upsert/limpeza; se estourou, devolve stopped_date.
      if (timeLeft() < 5000) {
        stoppedDate = date;
        // Marca todos os dias restantes como pending.
        const idx = days.indexOf(date);
        daysPending.push(...days.slice(idx));
        break;
      }

      const { from: dayFromSec, to: dayToSec } = dayBoundsUtc(date);
      const dayStats: DayStats = { date, orders: 0, inserted: 0, updated: 0, enqueued: 0, pages: 0 };

      let cursor = '';
      let more = true;

      while (more) {
        if (timeLeft() < 5000) {
          stoppedDate = date;
          const idx = days.indexOf(date);
          daysPending.push(...days.slice(idx));
          more = false;
          break;
        }

        const listResp = await shopeeCallWithRefresh<OrderListResp>(
          shop,
          '/api/v2/order/get_order_list',
          {
            time_range_field: 'create_time',
            time_from: dayFromSec,
            time_to: dayToSec,
            page_size: LIST_PAGE_SIZE,
            cursor,
          },
        );
        await sleep(THROTTLE_MS);

        dayStats.pages += 1;
        totalPages += 1;

        const snList = (listResp.response?.order_list ?? []).map(o => o.order_sn);
        more = listResp.response?.more === true;
        const nextCursor = listResp.response?.next_cursor || '';

        if (snList.length === 0) break;

        for (let i = 0; i < snList.length; i += DETAIL_CHUNK) {
          if (timeLeft() < 5000) {
            stoppedDate = date;
            const idx = days.indexOf(date);
            daysPending.push(...days.slice(idx));
            more = false;
            break;
          }

          const chunk = snList.slice(i, i + DETAIL_CHUNK);
          const detailResp = await shopeeCallWithRefresh<OrderDetailResp>(
            shop,
            '/api/v2/order/get_order_detail',
            { order_sn_list: chunk.join(','), response_optional_fields: DETAIL_FIELDS },
          );
          await sleep(THROTTLE_MS);

          const items = detailResp.response?.order_list ?? [];
          if (items.length === 0) continue;

          // Distinguir insert vs update — checa quem já existe.
          const orderSns = items.map(it => it.order_sn);
          const { data: prevRows } = await supabase
            .from('shopee_pedidos')
            .select('order_sn, order_status, complete_time')
            .eq('shop_id', shopId)
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
              shop_id: shopId,
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
            const prev = prevMap.get(it.order_sn);
            if (prev) dayStats.updated += 1;
            else dayStats.inserted += 1;
            if (it.order_status === 'COMPLETED' && prev?.order_status !== 'COMPLETED') {
              const created = await enqueueAction(
                shopId, 'escrow', it.order_sn, 'fetch_escrow_detail', 5,
              );
              if (created) dayStats.enqueued += 1;
            }
          }

          dayStats.orders += items.length;
        }

        cursor = nextCursor;
        if (!cursor) break;
      }

      // Só registra como processado se efetivamente terminou o dia (ou se não houve corte).
      if (stoppedDate === date) {
        // Deixa o dia como pending — o caller chama de novo com from=stopped_date.
        break;
      }

      daysProcessed.push(dayStats);
      totalOrders += dayStats.orders;
      totalInserted += dayStats.inserted;
      totalUpdated += dayStats.updated;
      totalEnqueued += dayStats.enqueued;
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][backfill-orders] shop_id=${shopId} ERRO:`, errorMsg);
  }

  const status: 'success' | 'partial' | 'error' = errorMsg
    ? 'error'
    : (daysPending.length > 0 ? 'partial' : 'success');

  const result: AuditResult = {
    pages_fetched: totalPages,
    rows_read: totalOrders,
    rows_inserted: totalInserted,
    rows_updated: totalUpdated,
    rows_enqueued: totalEnqueued,
    errors_count: errorMsg ? 1 : 0,
    error_message: errorMsg,
    metadata: {
      from,
      to,
      days_processed: daysProcessed.length,
      days_pending: daysPending.length,
      stopped_date: stoppedDate,
    },
  };
  await finishAudit(auditId, status, result, startedAt);

  console.log(
    `[shopee-sync][backfill-orders] shop_id=${shopId} from=${from} to=${to} status=${status} ` +
    `orders=${totalOrders} ins=${totalInserted} upd=${totalUpdated} enq=${totalEnqueued} ` +
    `processed=${daysProcessed.length} pending=${daysPending.length} elapsed=${elapsed()}ms`,
  );

  return NextResponse.json({
    job: JOB_NAME,
    shop_id: shopId,
    from,
    to,
    status,
    days_processed: daysProcessed,
    days_pending: daysPending,
    stopped_date: stoppedDate,
    total_orders: totalOrders,
    total_inserted: totalInserted,
    total_updated: totalUpdated,
    total_enqueued: totalEnqueued,
    duration_ms: elapsed(),
    error: errorMsg,
  });
}
