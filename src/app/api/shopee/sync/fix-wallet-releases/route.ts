import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopById, enqueueAction } from '@/lib/shopee/sync-helpers';

// Rota TEMPORÁRIA: reconcilia wallet → escrow para pedidos cujo get_escrow_list
// perdeu o release. Para cada ESCROW_VERIFIED_ADD da wallet com order_sn:
//
//   - Se o escrow já existe e tem is_released=true + escrow_release_time → already_ok
//   - Se o escrow existe mas está faltando release info → fixed (UPSERT com release)
//   - Se não existe → created_stub (UPSERT novo + enfileira fetch_escrow_detail)
//
// GET /api/shopee/sync/fix-wallet-releases?shop_id=XXX[&offset=N]
//
// Rodar repetidamente até `scanned=0` ou até `fixed+created_stubs=0`. Não está
// no cron — remover o arquivo quando o histórico estiver consistente.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const PAGE_SIZE = 1000; // limite PostgREST — pagina mesmo assim

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const shopIdParam = sp.get('shop_id');
  const offsetParam = sp.get('offset');

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

  const supabase = createServiceClient();
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  let offset = Number(offsetParam ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  let scanned = 0;
  let fixed = 0;
  let createdStubs = 0;
  let alreadyOk = 0;
  let enqueued = 0;

  let nextOffset: number | null = null;
  let done = false;

  while (timeLeft() > 5000) {
    const { data: walletRows } = await supabase
      .from('shopee_wallet')
      .select('order_sn, create_time, amount')
      .eq('shop_id', shopId)
      .eq('transaction_type', 'ESCROW_VERIFIED_ADD')
      .not('order_sn', 'is', null)
      .order('create_time', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (!walletRows || walletRows.length === 0) {
      done = true;
      break;
    }

    // Dedup por order_sn — como vem ordenado por create_time DESC, o primeiro
    // aparecimento é o release mais recente.
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
    scanned += orderSns.length;

    // Estado atual dos escrows (em chunks de 500 para IN-clause).
    const escrowMap = new Map<string, { is_released: boolean; escrow_release_time: string | null }>();
    const IN_CHUNK = 500;
    for (let i = 0; i < orderSns.length; i += IN_CHUNK) {
      const slice = orderSns.slice(i, i + IN_CHUNK);
      const { data: rows } = await supabase
        .from('shopee_escrow')
        .select('order_sn, is_released, escrow_release_time')
        .eq('shop_id', shopId)
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
    const nowIso = new Date().toISOString();

    for (const [orderSn, info] of Array.from(byOrderSn.entries())) {
      const ex = escrowMap.get(orderSn);
      if (!ex) {
        rowsToUpsert.push({
          shop_id: shopId, order_sn: orderSn, is_released: true,
          escrow_release_time: info.create_time, payout_amount: info.amount,
          synced_at: nowIso,
        });
        newSns.push(orderSn);
        createdStubs++;
      } else if (!ex.is_released || !ex.escrow_release_time) {
        rowsToUpsert.push({
          shop_id: shopId, order_sn: orderSn, is_released: true,
          escrow_release_time: info.create_time, payout_amount: info.amount,
          synced_at: nowIso,
        });
        fixed++;
      } else {
        alreadyOk++;
      }
    }

    // Upsert em chunks de 500 (evita payload gigante).
    const UP_CHUNK = 500;
    for (let i = 0; i < rowsToUpsert.length; i += UP_CHUNK) {
      const slice = rowsToUpsert.slice(i, i + UP_CHUNK);
      const { error } = await supabase
        .from('shopee_escrow')
        .upsert(slice, { onConflict: 'shop_id,order_sn' });
      if (error) throw new Error(`UPSERT shopee_escrow: ${error.message}`);
    }

    for (const sn of newSns) {
      if (timeLeft() < 3000) break;
      const ok = await enqueueAction(shopId, 'escrow', sn, 'fetch_escrow_detail', 5);
      if (ok) enqueued++;
    }

    if (walletRows.length < PAGE_SIZE) {
      done = true;
      break;
    }
    offset += PAGE_SIZE;
    if (timeLeft() < 5000) {
      nextOffset = offset;
      break;
    }
  }

  if (!done && nextOffset == null) nextOffset = offset;

  console.log(
    `[shopee-sync][fix-wallet-releases] shop_id=${shopId} scanned=${scanned} fixed=${fixed} stubs=${createdStubs} already_ok=${alreadyOk} enqueued=${enqueued} next_offset=${nextOffset ?? 'done'}`,
  );

  return NextResponse.json({
    job: 'fix_wallet_releases',
    shop_id: shopId,
    scanned,
    fixed,
    created_stubs: createdStubs,
    already_ok: alreadyOk,
    enqueued,
    next_offset: nextOffset,
    done,
    duration_ms: Date.now() - startedAt,
  });
}
