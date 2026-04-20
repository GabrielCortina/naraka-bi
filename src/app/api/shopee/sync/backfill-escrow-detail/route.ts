import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopById, shopeeCallWithRefresh, sleep } from '@/lib/shopee/sync-helpers';
import { mapEscrowDetailToRow, type EscrowDetailResponse } from '@/lib/shopee/escrow-mapper';

// Rota TEMPORÁRIA de backfill: preenche escrow_detail para linhas antigas
// que ficaram só com payout_amount (sem detail completo). Criada porque
// o escrow-list antigo dependia do worker; depois que o fluxo novo
// estabilizar, remover este arquivo.
//
// GET /api/shopee/sync/backfill-escrow-detail?shop_id=XXX&limit=100
//
// Não está no cron — chamar manualmente até remaining=0.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 500;
const DEFAULT_LIMIT = 100;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const shopIdParam = sp.get('shop_id');
  const limitParam = sp.get('limit');

  if (!shopIdParam) {
    return NextResponse.json({ error: 'shop_id é obrigatório' }, { status: 400 });
  }
  const shopId = Number(shopIdParam);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json({ error: 'loja não encontrada ou inativa' }, { status: 404 });
  }

  const limit = Math.min(Math.max(Number(limitParam ?? DEFAULT_LIMIT), 1), 500);
  const supabase = createServiceClient();
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  // Conta quantos faltam no total (diagnóstico — roda antes do loop).
  const { count: remainingBefore } = await supabase
    .from('shopee_escrow')
    .select('*', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .eq('is_released', true)
    .is('escrow_amount', null);

  // Pega o lote.
  const { data: pending } = await supabase
    .from('shopee_escrow')
    .select('order_sn, escrow_release_time, payout_amount')
    .eq('shop_id', shopId)
    .eq('is_released', true)
    .is('escrow_amount', null)
    .order('escrow_release_time', { ascending: false })
    .limit(limit);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const failures: Array<{ order_sn: string; error: string }> = [];

  for (const row of pending ?? []) {
    if (timeLeft() < 3000) break;

    processed++;
    const orderSn = row.order_sn as string;
    try {
      const resp = await shopeeCallWithRefresh<EscrowDetailResponse>(
        shop,
        '/api/v2/payment/get_escrow_detail',
        { order_sn: orderSn },
      );
      await sleep(THROTTLE_MS);

      const response = resp.response;
      if (!response?.order_sn) throw new Error('get_escrow_detail sem order_sn');

      const mapped = mapEscrowDetailToRow(shop.shop_id, response, response);
      const { error } = await supabase.from('shopee_escrow').upsert(
        {
          ...mapped,
          // Preserva o que o escrow-list já gravou — o detail não traz release info.
          escrow_release_time: row.escrow_release_time,
          payout_amount: row.payout_amount,
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
      failures.push({ order_sn: orderSn, error: msg.substring(0, 200) });
      console.warn(
        `[shopee-sync][backfill] shop_id=${shopId} order_sn=${orderSn} falhou:`,
        msg,
      );
    }
  }

  const remaining = Math.max(0, (remainingBefore ?? 0) - succeeded);

  console.log(
    `[shopee-sync][backfill] shop_id=${shopId} processed=${processed} succeeded=${succeeded} failed=${failed} remaining=${remaining}`,
  );

  return NextResponse.json({
    job: 'backfill_escrow_detail',
    shop_id: shopId,
    processed,
    succeeded,
    failed,
    remaining,
    duration_ms: Date.now() - startedAt,
    failures: failures.slice(0, 20),
  });
}
