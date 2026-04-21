import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Endpoint de monitoramento — agrega tudo o que /shopee-status precisa.
// Fonte principal: shopee_sync_audit (por execução). shopee_sync_checkpoint
// ainda é usada como fallback para jobs que ainda não gravaram audit.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TRACKED_JOBS: Array<{ job_name: string; label: string; max_idle_min: number }> = [
  { job_name: 'sync_orders',          label: 'Pedidos',                max_idle_min: 15 },
  { job_name: 'sync_worker',          label: 'Worker (fila)',          max_idle_min: 10 },
  { job_name: 'sync_wallet',          label: 'Carteira',               max_idle_min: 30 },
  { job_name: 'sync_escrow_list',     label: 'Escrow List',            max_idle_min: 30 },
  { job_name: 'sync_returns',         label: 'Devoluções',             max_idle_min: 30 },
  { job_name: 'sync_ads',             label: 'Ads',                    max_idle_min: 6 * 60 },
  { job_name: 'sync_reconciliation',  label: 'Conciliação',            max_idle_min: 30 },
  { job_name: 'healing_orders',       label: 'Healing Pedidos',        max_idle_min: 2 * 60 },
  { job_name: 'healing_wallet',       label: 'Healing Carteira',       max_idle_min: 25 * 60 },
  { job_name: 'reconcile_releases',   label: 'Reconciliação Releases', max_idle_min: 25 * 60 },
];

interface AuditRow {
  id: number;
  shop_id: number;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial' | 'error';
  window_from: string | null;
  window_to: string | null;
  pages_fetched: number | null;
  rows_read: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_enqueued: number | null;
  errors_count: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  duration_ms: number | null;
}

export async function GET() {
  const supabase = createServiceClient();
  const now = Date.now();
  const twentyFourHIso = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // Lojas ativas
  const { data: shopsData } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name, is_active, token_expires_at, refresh_expires_at, updated_at')
    .eq('is_active', true)
    .order('shop_id');
  const shops = (shopsData ?? []) as Array<{
    shop_id: number;
    shop_name: string | null;
    is_active: boolean;
    token_expires_at: string;
    refresh_expires_at: string;
    updated_at: string;
  }>;

  const [
    auditLatestRes,
    historyRes,
    queuePendingRes,
    queueProcessingRes,
    queueDoneRes,
    queueFailedRes,
    queueDeadRes,
    deadItemsRes,
    pedidosCountRes,
    escrowCountRes,
    escrowNoDetailRes,
    walletCountRes,
    adsCountRes,
    returnsCountRes,
    conciliacaoCountRes,
  ] = await Promise.all([
    // Buscamos os últimos 500 audits, o suficiente para cobrir a "última por
    // job" de ~10 jobs × várias lojas, e fazemos DISTINCT ON no cliente.
    supabase
      .from('shopee_sync_audit')
      .select(
        'id, shop_id, job_name, started_at, finished_at, status, window_from, window_to, pages_fetched, rows_read, rows_inserted, rows_updated, rows_enqueued, errors_count, error_message, metadata, duration_ms',
      )
      .order('started_at', { ascending: false })
      .limit(500),
    supabase
      .from('shopee_sync_audit')
      .select(
        'id, shop_id, job_name, started_at, finished_at, status, rows_read, rows_inserted, rows_updated, rows_enqueued, errors_count, error_message, duration_ms',
      )
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING'),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PROCESSING'),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DONE'),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'FAILED'),
    supabase
      .from('shopee_sync_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'DEAD'),
    supabase
      .from('shopee_sync_queue')
      .select('id, shop_id, entity_type, entity_id, action, dead_reason, attempt_count, max_attempts, last_error, updated_at')
      .eq('status', 'DEAD')
      .order('updated_at', { ascending: false })
      .limit(10),
    supabase.from('shopee_pedidos').select('*', { count: 'exact', head: true }),
    supabase.from('shopee_escrow').select('*', { count: 'exact', head: true }),
    supabase
      .from('shopee_escrow')
      .select('*', { count: 'exact', head: true })
      .eq('is_released', true)
      .is('escrow_amount', null),
    supabase.from('shopee_wallet').select('*', { count: 'exact', head: true }),
    supabase.from('shopee_ads_daily').select('*', { count: 'exact', head: true }),
    supabase.from('shopee_returns').select('*', { count: 'exact', head: true }),
    supabase.from('shopee_conciliacao').select('*', { count: 'exact', head: true }),
  ]);

  const allAudits = (auditLatestRes.data ?? []) as AuditRow[];

  // DISTINCT ON (job_name) — como vem ORDER BY started_at DESC, primeira
  // ocorrência por job é a mais recente.
  const latestByJob = new Map<string, AuditRow>();
  for (const a of allAudits) {
    if (!latestByJob.has(a.job_name)) latestByJob.set(a.job_name, a);
  }

  // Monta o card por job com fallback "nunca executou" para jobs sem audit.
  const jobs = TRACKED_JOBS.map(j => {
    const latest = latestByJob.get(j.job_name) ?? null;
    return {
      job_name: j.job_name,
      label: j.label,
      max_idle_min: j.max_idle_min,
      latest, // pode ser null
    };
  });

  // --- Alertas ---
  const alerts: Array<{
    kind: 'error' | 'stale' | 'divergence';
    job_name: string;
    label: string;
    message: string;
    started_at?: string | null;
    severity: 'warning' | 'critical';
  }> = [];

  for (const j of jobs) {
    const a = j.latest;
    if (!a) continue;

    const startedMs = new Date(a.started_at).getTime();
    const ageMin = (now - startedMs) / 60000;

    // 1) Erros nas últimas 24h
    if (a.status === 'error' && startedMs >= new Date(twentyFourHIso).getTime()) {
      alerts.push({
        kind: 'error',
        job_name: j.job_name,
        label: j.label,
        message: `${j.label} falhou: ${(a.error_message ?? 'erro sem mensagem').substring(0, 220)}`,
        started_at: a.started_at,
        severity: 'critical',
      });
    }

    // 2) Job não roda há mais do que o esperado
    if (ageMin > j.max_idle_min) {
      alerts.push({
        kind: 'stale',
        job_name: j.job_name,
        label: j.label,
        message: `${j.label} não roda há ${Math.round(ageMin)} min (limite: ${j.max_idle_min} min)`,
        started_at: a.started_at,
        severity: ageMin > j.max_idle_min * 3 ? 'critical' : 'warning',
      });
    }

    // 3) Divergência > 5% no reconcile_releases (metadata.alert=true)
    if (j.job_name === 'reconcile_releases' && a.metadata && (a.metadata as { alert?: boolean }).alert === true) {
      const ratio = (a.metadata as { divergence_ratio?: number }).divergence_ratio ?? 0;
      alerts.push({
        kind: 'divergence',
        job_name: j.job_name,
        label: j.label,
        message: `${j.label}: divergência alta (${(ratio * 100).toFixed(1)}%) entre wallet e escrow`,
        started_at: a.started_at,
        severity: 'critical',
      });
    }
  }

  // Tabelas
  const escrowTotal = escrowCountRes.count ?? 0;
  const escrowNoDetail = escrowNoDetailRes.count ?? 0;

  const tables = {
    shopee_pedidos:     pedidosCountRes.count ?? 0,
    shopee_escrow:      escrowTotal,
    shopee_escrow_sem_detail: escrowNoDetail,
    shopee_wallet:      walletCountRes.count ?? 0,
    shopee_ads_daily:   adsCountRes.count ?? 0,
    shopee_returns:     returnsCountRes.count ?? 0,
    shopee_conciliacao: conciliacaoCountRes.count ?? 0,
  };

  const queue = {
    pending:    queuePendingRes.count ?? 0,
    processing: queueProcessingRes.count ?? 0,
    done:       queueDoneRes.count ?? 0,
    failed:     queueFailedRes.count ?? 0,
    dead:       queueDeadRes.count ?? 0,
  };

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    jobs,
    alerts,
    tables,
    queue,
    queue_dead_items: deadItemsRes.data ?? [],
    history: historyRes.data ?? [],
    shops,
  });
}
