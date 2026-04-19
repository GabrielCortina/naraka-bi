import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Endpoint de monitoramento — agrega tudo o que a página /shopee-status precisa
// em uma única chamada. Retorna snapshot atual (no auto-refresh 30s na UI).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TRACKED_JOBS: Array<{ job_name: string; label: string }> = [
  { job_name: 'sync_orders', label: 'Sync Pedidos' },
  { job_name: 'sync_escrow_list', label: 'Escrow List' },
  { job_name: 'sync_wallet', label: 'Wallet' },
  { job_name: 'sync_returns', label: 'Returns' },
  { job_name: 'sync_ads', label: 'Ads' },
  { job_name: 'sync_reconciliation', label: 'Reconciliação' },
];

function startOfTodayIso(): string {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0).toISOString();
}

export async function GET() {
  const supabase = createServiceClient();
  const todayIso = startOfTodayIso();
  const twentyFourHIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const twoHoursIso = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

  // Lojas ativas primeiro — todas as demais queries usam esses shop_ids como filtro
  // para que a UI não polua com dados de lojas inativas (sandbox, deletadas, etc).
  const { data: activeShopsData } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name, is_active, token_expires_at, refresh_expires_at, updated_at')
    .eq('is_active', true)
    .order('shop_id');
  const activeShopIds = (activeShopsData ?? []).map(s => s.shop_id as number);

  // Se não há lojas ativas, retornamos snapshot vazio (UI não quebra).
  if (activeShopIds.length === 0) {
    return NextResponse.json({
      checked_at: new Date().toISOString(),
      tracked_jobs: TRACKED_JOBS,
      shops: [],
      checkpoints: [],
      queue: { pending: 0, processing: 0, done_24h: 0, failed: 0, dead: 0 },
      worker: { status: 'sem_dados' as const, last_done_at: null },
      table_counts: [],
      recent_errors: [],
      stats_today: { queue_done: 0, queue_failed: 0, success_rate: null, pedidos_synced: 0, escrow_synced: 0 },
    });
  }

  const [
    shopsRes,
    checkpointsRes,
    queuePendingRes,
    queueProcessingRes,
    queueDone24hRes,
    queueFailedRes,
    queueDeadRes,
    queueDoneTodayRes,
    queueFailedTodayRes,
    pedidosTodayRes,
    escrowTodayRes,
    recentErrorsRes,
    lastWorkerDoneRes,
  ] = await Promise.all([
    Promise.resolve({ data: activeShopsData }),
    supabase
      .from('shopee_sync_checkpoint')
      .select(
        'shop_id, job_name, last_window_from, last_window_to, last_cursor, last_success_at, last_error_at, last_error_message, is_running, updated_at',
      )
      .in('shop_id', activeShopIds)
      .order('updated_at', { ascending: false }),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING')
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PROCESSING')
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DONE')
      .gte('completed_at', twentyFourHIso)
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'FAILED')
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DEAD')
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DONE')
      .gte('completed_at', todayIso)
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .in('status', ['FAILED', 'DEAD'])
      .gte('updated_at', todayIso)
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_pedidos')
      .select('*', { count: 'exact', head: true })
      .gte('synced_at', todayIso)
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_escrow')
      .select('*', { count: 'exact', head: true })
      .gte('synced_at', todayIso)
      .in('shop_id', activeShopIds),
    supabase
      .from('shopee_sync_queue')
      .select('id, shop_id, entity_type, entity_id, action, status, attempt_count, max_attempts, last_error, updated_at')
      .in('status', ['FAILED', 'DEAD'])
      .gte('updated_at', twentyFourHIso)
      .in('shop_id', activeShopIds)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabase
      .from('shopee_sync_queue')
      .select('completed_at')
      .eq('status', 'DONE')
      .in('shop_id', activeShopIds)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const shops = (shopsRes.data as Array<{
    shop_id: number;
    shop_name: string | null;
    is_active: boolean;
    token_expires_at: string;
    refresh_expires_at: string;
    updated_at: string;
  }> | null) ?? [];

  // Contagens por loja para cada tabela (em paralelo por loja)
  const tableCounts = await Promise.all(
    shops.map(async shop => {
      const [pedidos, escrow, escrowReleased, wallet, returns, ads, conc] = await Promise.all([
        supabase.from('shopee_pedidos').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
        supabase.from('shopee_escrow').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
        supabase.from('shopee_escrow').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id).eq('is_released', true),
        supabase.from('shopee_wallet').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
        supabase.from('shopee_returns').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
        supabase.from('shopee_ads_daily').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
        supabase.from('shopee_conciliacao').select('*', { count: 'exact', head: true }).eq('shop_id', shop.shop_id),
      ]);
      const escrowTotal = escrow.count ?? 0;
      const escrowRel = escrowReleased.count ?? 0;
      return {
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        pedidos: pedidos.count ?? 0,
        escrow_total: escrowTotal,
        escrow_released: escrowRel,
        escrow_pending: Math.max(0, escrowTotal - escrowRel),
        wallet: wallet.count ?? 0,
        returns: returns.count ?? 0,
        ads_daily: ads.count ?? 0,
        conciliacao: conc.count ?? 0,
      };
    }),
  );

  const doneToday = queueDoneTodayRes.count ?? 0;
  const failedToday = queueFailedTodayRes.count ?? 0;
  const totalToday = doneToday + failedToday;
  const successRate = totalToday > 0 ? Math.round((doneToday / totalToday) * 1000) / 10 : null;

  const lastWorkerDone = (lastWorkerDoneRes.data as { completed_at: string | null } | null)?.completed_at ?? null;
  const workerOk =
    lastWorkerDone != null && new Date(lastWorkerDone).getTime() >= new Date(twoHoursIso).getTime();
  const workerStatus: 'ok' | 'erro' | 'sem_dados' =
    (queueDeadRes.count ?? 0) > 0
      ? 'erro'
      : lastWorkerDone == null
        ? 'sem_dados'
        : workerOk
          ? 'ok'
          : 'erro';

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    tracked_jobs: TRACKED_JOBS,
    shops,
    checkpoints: checkpointsRes.data ?? [],
    queue: {
      pending: queuePendingRes.count ?? 0,
      processing: queueProcessingRes.count ?? 0,
      done_24h: queueDone24hRes.count ?? 0,
      failed: queueFailedRes.count ?? 0,
      dead: queueDeadRes.count ?? 0,
    },
    worker: { status: workerStatus, last_done_at: lastWorkerDone },
    table_counts: tableCounts,
    recent_errors: recentErrorsRes.data ?? [],
    stats_today: {
      queue_done: doneToday,
      queue_failed: failedToday,
      success_rate: successRate,
      pedidos_synced: pedidosTodayRes.count ?? 0,
      escrow_synced: escrowTodayRes.count ?? 0,
    },
  });
}
