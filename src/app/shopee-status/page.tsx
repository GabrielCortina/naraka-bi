'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type AuditStatus = 'running' | 'success' | 'partial' | 'error';

interface AuditLatest {
  id: number;
  shop_id: number;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: AuditStatus;
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

interface AuditHistory {
  id: number;
  shop_id: number;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  status: AuditStatus;
  rows_read: number | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_enqueued: number | null;
  errors_count: number | null;
  error_message: string | null;
  duration_ms: number | null;
}

interface JobCard {
  job_name: string;
  label: string;
  max_idle_min: number;
  latest: AuditLatest | null;
}

interface Alert {
  kind: 'error' | 'stale' | 'divergence';
  job_name: string;
  label: string;
  message: string;
  started_at?: string | null;
  severity: 'warning' | 'critical';
}

interface DeadItem {
  id: number;
  shop_id: number;
  entity_type: string;
  entity_id: string | null;
  action: string;
  dead_reason: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
}

interface ShopRow {
  shop_id: number;
  shop_name: string | null;
  is_active: boolean;
  token_expires_at: string;
  refresh_expires_at: string;
  updated_at: string;
}

interface StatusData {
  checked_at: string;
  jobs: JobCard[];
  alerts: Alert[];
  tables: {
    shopee_pedidos: number;
    shopee_escrow: number;
    shopee_escrow_sem_detail: number;
    shopee_wallet: number;
    shopee_ads_daily: number;
    shopee_returns: number;
    shopee_conciliacao: number;
  };
  queue: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    dead: number;
  };
  queue_dead_items: DeadItem[];
  history: AuditHistory[];
  shops: ShopRow[];
}

const STATUS_STYLES: Record<AuditStatus, { cor: string; bg: string; label: string }> = {
  success: { cor: '#1D9E75', bg: '#E1F5EE', label: 'OK' },
  partial: { cor: '#A06B0F', bg: '#FAEEDA', label: 'PARCIAL' },
  error:   { cor: '#A32D2D', bg: '#FCEBEB', label: 'ERRO' },
  running: { cor: '#2C6BAA', bg: '#E4F0FB', label: 'RODANDO' },
};

function StatusBadge({ status }: { status: AuditStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: s.bg, color: s.cor }}
    >
      {s.label}
    </span>
  );
}

function TokenBadge({ expiresAt, isActive }: { expiresAt: string; isActive: boolean }) {
  const expired = new Date(expiresAt).getTime() < Date.now();
  const status: AuditStatus = !isActive ? 'error' : expired ? 'error' : 'success';
  const label = !isActive ? 'INATIVA' : expired ? 'EXPIRADO' : 'ATIVO';
  const s = STATUS_STYLES[status];
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: s.bg, color: s.cor }}
    >
      {label}
    </span>
  );
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'nunca';
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtN(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('pt-BR');
}

// Ordem de severidade para ordenar a lista de jobs: erro primeiro, depois
// mais antigos → mais recentes.
function jobSeverity(j: JobCard): number {
  if (!j.latest) return 3;
  if (j.latest.status === 'error') return 0;
  if (j.latest.status === 'partial') return 1;
  if (j.latest.status === 'running') return 2;
  return 4;
}

function SkeletonLine({ w = '60%' }: { w?: string }) {
  return (
    <span
      className="inline-block h-3 rounded animate-pulse"
      style={{ width: w, background: 'var(--skeleton-bg, rgba(120,120,120,0.18))' }}
    />
  );
}

function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card p-4 rounded-lg mb-4 space-y-2">
      <SkeletonLine w="30%" />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine key={i} w={`${60 + ((i * 13) % 35)}%`} />
      ))}
    </div>
  );
}

export default function ShopeeStatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<number | null>(null);
  const [filterJob, setFilterJob] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/shopee/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as StatusData;
      setData(json);
      setLastCheck(new Date());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro ao carregar status');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [fetchData]);

  const filteredHistory = useMemo(() => {
    if (!data) return [];
    return data.history.filter(h => {
      if (filterJob && h.job_name !== filterJob) return false;
      if (filterStatus && h.status !== filterStatus) return false;
      return true;
    });
  }, [data, filterJob, filterStatus]);

  const sortedJobs = useMemo(() => {
    if (!data) return [];
    return [...data.jobs].sort((a, b) => {
      const sa = jobSeverity(a);
      const sb = jobSeverity(b);
      if (sa !== sb) return sa - sb;
      const ta = a.latest ? new Date(a.latest.started_at).getTime() : 0;
      const tb = b.latest ? new Date(b.latest.started_at).getTime() : 0;
      return tb - ta;
    });
  }, [data]);

  if (!data) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">
            NARAKA | <span className="text-[#378ADD]">Shopee Sync &amp; Monitoramento</span>
          </h1>
          <p className="text-xs mt-0.5 opacity-50">
            {loadError ? `Erro: ${loadError}` : 'Carregando…'}
          </p>
        </div>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  const { jobs, alerts, tables, queue, queue_dead_items, shops } = data;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Shopee Sync &amp; Monitoramento</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Última verificação: {formatHora(lastCheck.toISOString())} · auto-refresh 30s
          {loadError && <span className="text-[#E24B4A] ml-2">(último fetch falhou: {loadError})</span>}
        </p>
      </div>

      {/* SEÇÃO 1 — STATUS DOS JOBS */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">STATUS DOS JOBS</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sortedJobs.map(j => {
            const a = j.latest;
            return (
              <div key={j.job_name} className="card-secondary p-3 rounded-lg">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{j.label}</p>
                    <p className="text-[10px] opacity-40 font-mono">{j.job_name}</p>
                  </div>
                  {a ? <StatusBadge status={a.status} /> : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded" style={{ background: '#F1EFE8', color: '#888' }}>
                      NUNCA
                    </span>
                  )}
                </div>
                {a ? (
                  <div className="space-y-0.5">
                    <p className="text-[10px] opacity-60">
                      Última execução: {formatRelative(a.started_at)}
                    </p>
                    <p className="text-[10px] opacity-60">
                      Duração: {formatDuration(a.duration_ms)}
                    </p>
                    <p className="text-[10px] opacity-60">
                      Leu {fmtN(a.rows_read)} · Inseriu {fmtN(a.rows_inserted)} · Atualizou {fmtN(a.rows_updated)}
                    </p>
                    {a.error_message && (
                      <p
                        className="text-[10px] mt-1 truncate"
                        title={a.error_message}
                        style={{ color: '#A32D2D' }}
                      >
                        {a.error_message}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] opacity-40">Ainda não rodou</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* SEÇÃO 2 — ALERTAS */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ALERTAS</h2>
        {alerts.length === 0 ? (
          <p className="text-xs" style={{ color: '#1D9E75' }}>
            ✓ Tudo OK — nenhum alerta ativo
          </p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, idx) => {
              const color = a.severity === 'critical' ? '#A32D2D' : '#A06B0F';
              const bg = a.severity === 'critical' ? '#FCEBEB' : '#FAEEDA';
              const icon = a.kind === 'error' ? '⚠' : a.kind === 'stale' ? '⏱' : '⚖';
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded"
                  style={{ background: bg }}
                >
                  <span className="text-sm leading-tight" style={{ color }}>{icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs break-words" style={{ color }}>{a.message}</p>
                    {a.started_at && (
                      <p className="text-[10px] opacity-60 mt-0.5" style={{ color }}>
                        {formatDataHora(a.started_at)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SEÇÃO 3 — TABELAS */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">TABELAS</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <div>
            <p className="text-[10px] opacity-50 mb-1">Pedidos</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_pedidos)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Escrow</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_escrow)}</p>
            {tables.shopee_escrow_sem_detail > 0 && (
              <p className="text-[10px]" style={{ color: '#EF9F27' }}>
                {fmtN(tables.shopee_escrow_sem_detail)} sem detail
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Wallet</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_wallet)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Ads (dias)</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_ads_daily)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Devoluções</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_returns)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Conciliação</p>
            <p className="text-sm font-medium">{fmtN(tables.shopee_conciliacao)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Fila total</p>
            <p className="text-sm font-medium">
              {fmtN(queue.pending + queue.processing + queue.done + queue.failed + queue.dead)}
            </p>
          </div>
        </div>
      </div>

      {/* SEÇÃO 4 — FILA */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">FILA DE TAREFAS</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] opacity-50 mb-1">PENDING</p>
            <p
              className="text-sm font-medium"
              style={{
                color: queue.pending > 1000 ? '#E24B4A' : queue.pending > 100 ? '#EF9F27' : '#1D9E75',
              }}
            >
              {fmtN(queue.pending)}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">PROCESSING</p>
            <p
              className="text-sm font-medium"
              style={{ color: queue.processing > 50 ? '#E24B4A' : undefined }}
            >
              {fmtN(queue.processing)}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">DONE</p>
            <p className="text-sm font-medium">{fmtN(queue.done)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">FAILED</p>
            <p className="text-sm font-medium" style={{ color: queue.failed > 0 ? '#E24B4A' : undefined }}>
              {fmtN(queue.failed)}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">DEAD</p>
            <p className="text-sm font-medium" style={{ color: queue.dead > 0 ? '#E24B4A' : undefined }}>
              {fmtN(queue.dead)}
            </p>
          </div>
        </div>

        {queue_dead_items.length > 0 && (
          <div className="mt-4 pt-4 border-t border-current/5">
            <p className="text-[10px] font-medium opacity-70 mb-2">ÚLTIMAS DEAD (10)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left opacity-50">
                    <th className="pb-2 pr-2">Tipo</th>
                    <th className="pb-2 pr-2">Entity ID</th>
                    <th className="pb-2 pr-2">Action</th>
                    <th className="pb-2 pr-2">Razão</th>
                    <th className="pb-2 pr-2 text-right">Tent.</th>
                    <th className="pb-2 pr-2">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {queue_dead_items.map(d => (
                    <tr key={d.id} className="border-t border-current/5">
                      <td className="py-1.5 pr-2">{d.entity_type}</td>
                      <td className="py-1.5 pr-2 font-mono text-[10px]">{d.entity_id ?? '—'}</td>
                      <td className="py-1.5 pr-2 text-[10px]">{d.action}</td>
                      <td className="py-1.5 pr-2 text-[10px] opacity-70" title={d.last_error ?? ''}>
                        {d.dead_reason ?? (d.last_error ? d.last_error.substring(0, 40) : '—')}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        {d.attempt_count}/{d.max_attempts}
                      </td>
                      <td className="py-1.5 pr-2 text-[10px]">{formatDataHora(d.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SEÇÃO 5 — HISTÓRICO */}
      <div className="card p-4 rounded-lg mb-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="text-xs font-medium opacity-70">HISTÓRICO DE EXECUÇÕES</h2>
          <div className="flex gap-2">
            <select
              value={filterJob}
              onChange={e => setFilterJob(e.target.value)}
              className="text-[10px] px-2 py-1 rounded border border-current/10 bg-transparent"
            >
              <option value="">Todos os jobs</option>
              {jobs.map(j => (
                <option key={j.job_name} value={j.job_name}>{j.label}</option>
              ))}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-[10px] px-2 py-1 rounded border border-current/10 bg-transparent"
            >
              <option value="">Todos os status</option>
              <option value="success">Sucesso</option>
              <option value="partial">Parcial</option>
              <option value="error">Erro</option>
              <option value="running">Rodando</option>
            </select>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="text-xs opacity-40">Nenhuma execução corresponde aos filtros</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50">
                  <th className="pb-2 pr-2">Job</th>
                  <th className="pb-2 pr-2">Loja</th>
                  <th className="pb-2 pr-2">Status</th>
                  <th className="pb-2 pr-2">Início</th>
                  <th className="pb-2 pr-2 text-right">Dur.</th>
                  <th className="pb-2 pr-2 text-right">Leu</th>
                  <th className="pb-2 pr-2 text-right">Ins.</th>
                  <th className="pb-2 pr-2 text-right">Atu.</th>
                  <th className="pb-2 pr-2 text-right">Enf.</th>
                  <th className="pb-2 pr-2 text-right">Err.</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map(h => {
                  const shopLabel = h.shop_id === 0
                    ? '—'
                    : (shops.find(s => s.shop_id === h.shop_id)?.shop_name ?? `#${h.shop_id}`);
                  const jobLabel = jobs.find(j => j.job_name === h.job_name)?.label ?? h.job_name;
                  const expanded = expandedError === h.id;
                  return (
                    <tr key={h.id} className="border-t border-current/5 align-top">
                      <td className="py-1.5 pr-2">
                        <div>{jobLabel}</div>
                        {h.error_message && (
                          <button
                            onClick={() => setExpandedError(expanded ? null : h.id)}
                            className="text-[10px] mt-0.5"
                            style={{ color: '#A32D2D' }}
                          >
                            {expanded ? '▼ ocultar erro' : '▶ ver erro'}
                          </button>
                        )}
                        {expanded && h.error_message && (
                          <p
                            className="text-[10px] mt-1 whitespace-pre-wrap break-words"
                            style={{ color: '#A32D2D' }}
                          >
                            {h.error_message}
                          </p>
                        )}
                      </td>
                      <td className="py-1.5 pr-2 text-[10px] opacity-70">{shopLabel}</td>
                      <td className="py-1.5 pr-2"><StatusBadge status={h.status} /></td>
                      <td className="py-1.5 pr-2 text-[10px]">{formatDataHora(h.started_at)}</td>
                      <td className="py-1.5 pr-2 text-right text-[10px]">{formatDuration(h.duration_ms)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtN(h.rows_read)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtN(h.rows_inserted)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtN(h.rows_updated)}</td>
                      <td className="py-1.5 pr-2 text-right">{fmtN(h.rows_enqueued)}</td>
                      <td
                        className="py-1.5 pr-2 text-right"
                        style={{ color: (h.errors_count ?? 0) > 0 ? '#A32D2D' : undefined }}
                      >
                        {fmtN(h.errors_count)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SEÇÃO 6 — LOJAS */}
      <div className="card p-4 rounded-lg">
        <h2 className="text-xs font-medium opacity-70 mb-3">LOJAS CONECTADAS</h2>
        {shops.length === 0 ? (
          <p className="text-xs opacity-40">Nenhuma loja conectada</p>
        ) : (
          <div className="space-y-2">
            {shops.map(s => (
              <div key={s.shop_id} className="flex items-center justify-between py-1.5 flex-wrap gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs truncate">
                    {s.shop_name || `Shop ${s.shop_id}`}
                  </span>
                  <span className="text-[10px] opacity-40 font-mono">#{s.shop_id}</span>
                </div>
                <div className="flex items-center gap-3">
                  <TokenBadge expiresAt={s.token_expires_at} isActive={s.is_active} />
                  <span className="text-[10px] opacity-40">
                    Token expira: {formatDataHora(s.token_expires_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
