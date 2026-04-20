import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopById, shopeeCallWithRefresh, sleep } from '@/lib/shopee/sync-helpers';
import { mapEscrowDetailToRow, type EscrowDetailResponse } from '@/lib/shopee/escrow-mapper';

// Rota TEMPORÁRIA de backfill: preenche escrow_detail para linhas antigas
// que ficaram só com payout_amount (sem detail completo). Criada porque
// o escrow-list antigo dependia do worker; depois que o fluxo novo
// estabilizar, remover este arquivo.
//
// Usa POST /api/v2/payment/get_escrow_detail_batch — até 50 order_sn por
// chamada. Com limit=500 processamos o lote em ~10 chamadas (~10s com throttle).
// Ref: shopee-payment-docs.md §4.
//
// GET /api/shopee/sync/backfill-escrow-detail?shop_id=XXX&limit=500
//
// Chamado pelo cron a cada 2 min enquanto remaining > 0 — depois remover do
// vercel.json.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const BATCH_SIZE = 50;          // limite da API Shopee
const THROTTLE_MS = 1000;       // pausa entre batches
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

// Default shop_id usado pelo cron. Se o cron disparar sem query params, cai
// aqui; se outra loja precisar, basta trocar a path no vercel.json.
const DEFAULT_CRON_SHOP_ID = 869193731;

interface BatchItem {
  // A Shopee usa tanto a forma `{ escrow_detail: { ... } }` quanto a forma
  // "flat" (o próprio payload do detail) dependendo da versão do endpoint.
  // Aceitamos as duas.
  escrow_detail?: EscrowDetailResponse;
  order_sn?: string;
  buyer_user_name?: string;
  return_order_sn_list?: string[];
  order_income?: Record<string, unknown>;
  buyer_payment_info?: Record<string, unknown>;
}

function extractDetail(item: BatchItem): EscrowDetailResponse | null {
  if (item.escrow_detail?.order_sn) return item.escrow_detail;
  if (item.order_sn) {
    return {
      order_sn: item.order_sn,
      buyer_user_name: item.buyer_user_name,
      return_order_sn_list: item.return_order_sn_list,
      order_income: item.order_income,
      buyer_payment_info: item.buyer_payment_info,
    };
  }
  return null;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const shopIdParam = sp.get('shop_id');
  const limitParam = sp.get('limit');

  const shopId = shopIdParam ? Number(shopIdParam) : DEFAULT_CRON_SHOP_ID;
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json({ error: 'loja não encontrada ou inativa' }, { status: 404 });
  }

  const limit = Math.min(
    Math.max(Number(limitParam ?? DEFAULT_LIMIT), BATCH_SIZE),
    MAX_LIMIT,
  );
  const supabase = createServiceClient();
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const { count: remainingBefore } = await supabase
    .from('shopee_escrow')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .eq('is_released', true)
    .is('escrow_amount', null);

  const { data: pending } = await supabase
    .from('shopee_escrow')
    .select('order_sn, escrow_release_time, payout_amount')
    .eq('shop_id', shopId)
    .eq('is_released', true)
    .is('escrow_amount', null)
    .order('escrow_release_time', { ascending: false })
    .limit(limit);

  const pendingRows = (pending ?? []) as Array<{
    order_sn: string;
    escrow_release_time: string | null;
    payout_amount: number | null;
  }>;

  // Index por order_sn → preserva release info no upsert.
  const releaseMap = new Map<string, { escrow_release_time: string | null; payout_amount: number | null }>();
  for (const row of pendingRows) {
    releaseMap.set(row.order_sn, {
      escrow_release_time: row.escrow_release_time,
      payout_amount: row.payout_amount,
    });
  }

  let batchesDone = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ order_sn: string; error: string }> = [];

  for (let i = 0; i < pendingRows.length; i += BATCH_SIZE) {
    if (timeLeft() < 3000) break;

    const chunk = pendingRows.slice(i, i + BATCH_SIZE);
    const orderSnList = chunk.map(r => r.order_sn);
    processed += chunk.length;

    try {
      const resp = await shopeeCallWithRefresh<BatchItem[]>(
        shop,
        '/api/v2/payment/get_escrow_detail_batch',
        { order_sn_list: orderSnList },
        'POST',
      );
      batchesDone++;

      const items = (resp.response as BatchItem[] | undefined) ?? [];
      const seen = new Set<string>();

      for (const item of items) {
        const detail = extractDetail(item);
        if (!detail?.order_sn) continue;
        seen.add(detail.order_sn);

        try {
          const mapped = mapEscrowDetailToRow(shop.shop_id, detail, detail);
          const release = releaseMap.get(detail.order_sn);
          const { error } = await supabase.from('shopee_escrow').upsert(
            {
              ...mapped,
              escrow_release_time: release?.escrow_release_time ?? null,
              payout_amount: release?.payout_amount ?? null,
              is_released: true,
              synced_at: new Date().toISOString(),
            },
            { onConflict: 'shop_id,order_sn' },
          );
          if (error) throw new Error(`UPSERT: ${error.message}`);
          succeeded++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : 'unknown';
          failures.push({ order_sn: detail.order_sn, error: msg.substring(0, 200) });
        }
      }

      // order_sn que o batch devolveu sem detail útil contam como falha —
      // assim o diagnóstico no response já mostra.
      for (const sn of orderSnList) {
        if (!seen.has(sn)) {
          failed++;
          failures.push({ order_sn: sn, error: 'batch sem retorno para este order_sn' });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      failed += chunk.length;
      for (const sn of orderSnList) {
        failures.push({ order_sn: sn, error: `batch falhou: ${msg.substring(0, 160)}` });
      }
      console.warn(
        `[shopee-sync][backfill] batch falhou shop_id=${shopId} size=${chunk.length}:`,
        msg,
      );
    }

    await sleep(THROTTLE_MS);
  }

  const remaining = Math.max(0, (remainingBefore ?? 0) - succeeded);

  console.log(
    `[shopee-sync][backfill] shop_id=${shopId} batches=${batchesDone} processed=${processed} succeeded=${succeeded} failed=${failed} remaining=${remaining} duration_ms=${Date.now() - startedAt}`,
  );

  return NextResponse.json({
    job: 'backfill_escrow_detail',
    shop_id: shopId,
    batches: batchesDone,
    processed,
    succeeded,
    failed,
    remaining,
    duration_ms: Date.now() - startedAt,
    failures: failures.slice(0, 20),
  });
}
