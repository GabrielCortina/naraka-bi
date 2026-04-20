import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getShopById,
  shopeeCallWithRefresh,
  sleep,
  tsToIso,
} from '@/lib/shopee/sync-helpers';

// Rota temporária para repuxar wallet de um período específico.
// GET ?shop_id=869193731&from=2026-04-06&to=2026-04-20
// Não respeita MAX_PAGES — pagina até more=false ou timeout interno (45s).

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 500;
const PAGE_SIZE = 100;

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  const timeLeft = () => MAX_ELAPSED_MS - elapsed();

  const shopIdParam = request.nextUrl.searchParams.get('shop_id');
  const fromParam = request.nextUrl.searchParams.get('from');
  const toParam = request.nextUrl.searchParams.get('to');

  if (!shopIdParam || !fromParam || !toParam) {
    return NextResponse.json(
      { error: 'shop_id, from, to obrigatórios (from/to em YYYY-MM-DD)' },
      { status: 400 },
    );
  }
  if (!DATE_RE.test(fromParam) || !DATE_RE.test(toParam)) {
    return NextResponse.json({ error: 'from/to devem ser YYYY-MM-DD' }, { status: 400 });
  }

  const shopId = Number(shopIdParam);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  // BRT = UTC-3 (sem horário de verão desde 2019).
  // 00:00 BRT de `from` = 03:00 UTC do mesmo dia.
  // 23:59:59 BRT de `to`  = 02:59:59 UTC do dia seguinte.
  const fromSec = Math.floor(Date.parse(`${fromParam}T03:00:00Z`) / 1000);
  const toSec = Math.floor(Date.parse(`${toParam}T03:00:00Z`) / 1000) + 86400 - 1;

  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || toSec <= fromSec) {
    return NextResponse.json({ error: 'from/to inválidos' }, { status: 400 });
  }

  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json(
      { error: `shop ${shopId} inativa ou não encontrada` },
      { status: 404 },
    );
  }

  const supabase = createServiceClient();

  let totalFetched = 0;
  let newInserted = 0;
  let alreadyExisted = 0;
  let releasesFixed = 0;
  let pagesFetched = 0;
  let pageNo = 1;
  let timedOut = false;
  let more = false;

  try {
    while (true) {
      if (timeLeft() < 5000) { timedOut = true; break; }

      const resp = await shopeeCallWithRefresh<WalletResp>(
        shop,
        '/api/v2/payment/get_wallet_transaction_list',
        {
          page_no: pageNo,
          page_size: PAGE_SIZE,
          create_time_from: fromSec,
          create_time_to: toSec,
        },
      );
      pagesFetched++;

      const txns = (resp.response?.transaction_list ?? []).filter(
        t => t.transaction_id != null && t.create_time != null,
      );
      more = resp.response?.more === true;

      if (txns.length === 0) {
        if (!more) break;
        pageNo++;
        await sleep(THROTTLE_MS);
        continue;
      }

      const txnIds = txns.map(t => t.transaction_id!);
      const { data: existingRows, error: selErr } = await supabase
        .from('shopee_wallet')
        .select('transaction_id')
        .eq('shop_id', shop.shop_id)
        .in('transaction_id', txnIds);
      if (selErr) throw new Error(`SELECT shopee_wallet: ${selErr.message}`);
      const existingIds = new Set<number>(
        (existingRows ?? []).map(r => r.transaction_id as number),
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

      // ESCROW_VERIFIED_ADD → marcar escrow como liberado.
      // Dedup por order_sn, mantendo o txn mais recente.
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

        const { data: notReleased, error: escSelErr } = await supabase
          .from('shopee_escrow')
          .select('order_sn')
          .eq('shop_id', shop.shop_id)
          .eq('is_released', false)
          .in('order_sn', uniqSns);
        if (escSelErr) throw new Error(`SELECT shopee_escrow: ${escSelErr.message}`);

        if (notReleased && notReleased.length > 0) {
          const updates = notReleased.map(e => {
            const txn = releaseBySn.get(e.order_sn as string)!;
            return {
              shop_id: shop.shop_id,
              order_sn: e.order_sn as string,
              is_released: true,
              escrow_release_time: tsToIso(txn.create_time!),
              synced_at: nowIso,
            };
          });
          const { error: escUpErr } = await supabase
            .from('shopee_escrow')
            .upsert(updates, { onConflict: 'shop_id,order_sn' });
          if (escUpErr) throw new Error(`UPSERT shopee_escrow: ${escUpErr.message}`);
          releasesFixed += updates.length;
        }
      }

      if (!more) break;
      pageNo++;
      await sleep(THROTTLE_MS);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-refill-wallet] shop_id=${shopId} ERRO:`, msg);
    return NextResponse.json(
      {
        shop_id: shopId,
        error: msg,
        partial: {
          total_fetched: totalFetched,
          new_inserted: newInserted,
          already_existed: alreadyExisted,
          releases_fixed: releasesFixed,
          pages_fetched: pagesFetched,
        },
      },
      { status: 502 },
    );
  }

  console.log(
    `[shopee-refill-wallet] shop_id=${shopId} total=${totalFetched} new=${newInserted} existed=${alreadyExisted} released=${releasesFixed} pages=${pagesFetched} timed_out=${timedOut} more=${more}`,
  );

  return NextResponse.json({
    shop_id: shopId,
    window: { from: fromParam, to: toParam },
    total_fetched: totalFetched,
    new_inserted: newInserted,
    already_existed: alreadyExisted,
    releases_fixed: releasesFixed,
    pages_fetched: pagesFetched,
    timed_out: timedOut,
    more_remaining: more,
    duration_ms: elapsed(),
  });
}
