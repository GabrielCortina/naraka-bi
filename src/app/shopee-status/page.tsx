'use client';

import { useCallback, useEffect, useState } from 'react';

interface Checkpoint {
  shop_id: number;
  job_name: string;
  last_window_from: string | null;
  last_window_to: string | null;
  last_cursor: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  is_running: boolean;
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

interface TableCount {
  shop_id: number;
  shop_name: string | null;
  pedidos: number;
  escrow_total: number;
  escrow_released: number;
  escrow_pending: number;
  wallet: number;
  returns: number;
  ads_daily: number;
  conciliacao: number;
}

interface RecentError {
  id: number;
  shop_id: number;
  entity_type: string;
  entity_id: string | null;
  action: string;
  status: 'FAILED' | 'DEAD';
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  updated_at: string;
}

interface StatusData {
  checked_at: string;
  tracked_jobs: Array<{ job_name: string; label: string }>;
  shops: ShopRow[];
  checkpoints: Checkpoint[];
  queue: { pending: number; processing: number; done_24h: number; failed: number; dead: number };
  worker: { status: 'ok' | 'erro' | 'sem_dados'; last_done_at: string | null };
  table_counts: TableCount[];
  recent_errors: RecentError[];
  stats_today: {
    queue_done: number;
    queue_failed: number;
    success_rate: number | null;
    pedidos_synced: number;
    escrow_synced: number;
  };
}

type Status = 'ok' | 'erro' | 'sem_dados';

const STATUS_CONFIG: Record<Status, { cor: string; label: string; bg: string }> = {
  ok: { cor: '#1D9E75', label: 'OK', bg: '#E1F5EE' },
  erro: { cor: '#E24B4A', label: 'ERRO', bg: '#FCEBEB' },
  sem_dados: { cor: '#888', label: 'SEM DADOS', bg: '#F1EFE8' },
};

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatHoraComData(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function deriveStatus(ck: Checkpoint | undefined): Status {
  if (!ck) return 'sem_dados';
  const err = ck.last_error_at ? new Date(ck.last_error_at).getTime() : null;
  const suc = ck.last_success_at ? new Date(ck.last_success_at).getTime() : null;
  if (err && (!suc || err > suc)) return 'erro';
  if (suc) return 'ok';
  return 'sem_dados';
}

function StatusBadge({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: cfg.bg, color: cfg.cor }}
    >
      {cfg.label}
    </span>
  );
}

function TokenBadge({ expiresAt, isActive }: { expiresAt: string; isActive: boolean }) {
  const expired = new Date(expiresAt).getTime() < Date.now();
  const status: Status = !isActive ? 'erro' : expired ? 'erro' : 'ok';
  const label = !isActive ? 'INATIVA' : expired ? 'EXPIRADO' : 'ATIVO';
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: cfg.bg, color: cfg.cor }}
    >
      {label}
    </span>
  );
}

export default function ShopeeStatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const [loadError, setLoadError] = useState<string | null>(null);

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

  if (!data) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Shopee Sync & Monitoramento</span>
        </h1>
        <p className="text-xs mt-4 opacity-50">
          {loadError ? `Erro: ${loadError}` : 'Carregando…'}
        </p>
      </div>
    );
  }

  const ckByKey = new Map<string, Checkpoint>();
  for (const ck of data.checkpoints) {
    ckByKey.set(`${ck.shop_id}:${ck.job_name}`, ck);
  }

  // Status agregado por job (pior status entre as lojas)
  const jobStatuses = data.tracked_jobs.map(job => {
    const perShop = data.shops.map(s => {
      const ck = ckByKey.get(`${s.shop_id}:${job.job_name}`);
      return { shop: s, ck, status: deriveStatus(ck) };
    });
    const hasError = perShop.some(p => p.status === 'erro');
    const hasOk = perShop.some(p => p.status === 'ok');
    const status: Status = hasError ? 'erro' : hasOk ? 'ok' : 'sem_dados';
    const latestSuccess = perShop
      .map(p => p.ck?.last_success_at)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1);
    return { ...job, status, last_success_at: latestSuccess ?? null, perShop };
  });

  const { queue, worker, stats_today, table_counts, recent_errors, shops } = data;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Shopee Sync & Monitoramento</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Última verificação: {formatHora(lastCheck.toISOString())} · auto-refresh 30s
        </p>
      </div>

      {/* Status Geral dos Jobs */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">STATUS GERAL</h2>
        <div className="space-y-2">
          {jobStatuses.map(j => (
            <div key={j.job_name} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[j.status].cor }} />
                <span className="text-xs">{j.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={j.status} />
                {j.last_success_at ? (
                  <span className="text-[10px] opacity-40">
                    Último: {formatHoraComData(j.last_success_at)}
                  </span>
                ) : (
                  <span className="text-[10px] opacity-30">Nunca executou</span>
                )}
              </div>
            </div>
          ))}

          {/* Worker */}
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[worker.status].cor }} />
              <span className="text-xs">Worker (fila de pendências)</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={worker.status} />
              {worker.last_done_at ? (
                <span className="text-[10px] opacity-40">
                  Último item concluído: {formatHoraComData(worker.last_done_at)}
                </span>
              ) : (
                <span className="text-[10px] opacity-30">Sem items concluídos</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lojas Conectadas */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">LOJAS CONECTADAS</h2>
        {shops.length === 0 ? (
          <p className="text-xs opacity-40">Nenhuma loja conectada</p>
        ) : (
          <div className="space-y-2">
            {shops.map(s => (
              <div key={s.shop_id} className="flex items-center justify-between py-1.5">
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

      {/* Dead Letter Banner */}
      {queue.dead > 0 && (
        <div className="p-3 rounded-lg mb-4" style={{ background: '#FCEBEB' }}>
          <p className="text-xs" style={{ color: '#A32D2D' }}>
            ⚠️ <span className="font-semibold">{queue.dead}</span> {queue.dead === 1 ? 'item' : 'itens'} na dead letter — investigar manualmente
          </p>
        </div>
      )}

      {/* Fila de Pendências */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">FILA DE PENDÊNCIAS</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] opacity-50 mb-1">PENDING</p>
            <p className="text-sm font-medium">{queue.pending.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">PROCESSING</p>
            <p className="text-sm font-medium">{queue.processing.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">DONE (24h)</p>
            <p className="text-sm font-medium" style={{ color: queue.done_24h > 0 ? '#1D9E75' : undefined }}>
              {queue.done_24h.toLocaleString('pt-BR')}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">FAILED</p>
            <p className="text-sm font-medium" style={{ color: queue.failed > 0 ? '#EF9F27' : undefined }}>
              {queue.failed.toLocaleString('pt-BR')}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">DEAD</p>
            <p className="text-sm font-medium" style={{ color: queue.dead > 0 ? '#E24B4A' : undefined }}>
              {queue.dead.toLocaleString('pt-BR')}
            </p>
          </div>
        </div>
      </div>

      {/* Tabelas do Banco */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">TABELAS DO BANCO</h2>
        {table_counts.length === 0 ? (
          <p className="text-xs opacity-40">Nenhum dado</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50">
                  <th className="pb-2">Loja</th>
                  <th className="pb-2 text-right">Pedidos</th>
                  <th className="pb-2 text-right">Escrow</th>
                  <th className="pb-2 text-right">Wallet</th>
                  <th className="pb-2 text-right">Returns</th>
                  <th className="pb-2 text-right">Ads</th>
                  <th className="pb-2 text-right">Conciliação</th>
                </tr>
              </thead>
              <tbody>
                {table_counts.map(tc => (
                  <tr key={tc.shop_id} className="border-t border-current/5">
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <span>{tc.shop_name || `Shop ${tc.shop_id}`}</span>
                        <span className="text-[10px] opacity-40 font-mono">#{tc.shop_id}</span>
                      </div>
                    </td>
                    <td className="py-1.5 text-right">{tc.pedidos.toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 text-right">
                      {tc.escrow_total.toLocaleString('pt-BR')}{' '}
                      <span className="text-[10px] opacity-50">
                        ({tc.escrow_released} liberados / {tc.escrow_pending} pend)
                      </span>
                    </td>
                    <td className="py-1.5 text-right">{tc.wallet.toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 text-right">{tc.returns.toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 text-right">{tc.ads_daily.toLocaleString('pt-BR')}</td>
                    <td className="py-1.5 text-right">{tc.conciliacao.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Últimas Execuções */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ÚLTIMAS EXECUÇÕES</h2>
        {data.checkpoints.length === 0 ? (
          <p className="text-xs opacity-40">Nenhuma execução registrada</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50">
                  <th className="pb-2">Job</th>
                  <th className="pb-2">Loja</th>
                  <th className="pb-2">Último Sucesso</th>
                  <th className="pb-2">Último Erro</th>
                  <th className="pb-2">Janela</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.checkpoints.slice(0, 20).map(ck => {
                  const status = deriveStatus(ck);
                  const label = data.tracked_jobs.find(j => j.job_name === ck.job_name)?.label ?? ck.job_name;
                  const shopName =
                    shops.find(s => s.shop_id === ck.shop_id)?.shop_name ?? `Shop ${ck.shop_id}`;
                  return (
                    <tr key={`${ck.shop_id}:${ck.job_name}`} className="border-t border-current/5">
                      <td className="py-1.5">{label}</td>
                      <td className="py-1.5 text-[10px] opacity-70">{shopName}</td>
                      <td className="py-1.5 text-[10px]">
                        {ck.last_success_at ? formatHoraComData(ck.last_success_at) : '—'}
                      </td>
                      <td className="py-1.5 text-[10px]" style={{ color: ck.last_error_at ? '#E24B4A' : undefined }}>
                        {ck.last_error_at ? formatHoraComData(ck.last_error_at) : '—'}
                      </td>
                      <td className="py-1.5 text-[10px] opacity-70">
                        {ck.last_window_from && ck.last_window_to
                          ? `${formatHoraComData(ck.last_window_from)} → ${formatHoraComData(ck.last_window_to)}`
                          : '—'}
                      </td>
                      <td className="py-1.5 text-right">
                        <StatusBadge status={status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Erros Recentes */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ERROS RECENTES (últimas 24h)</h2>
        {recent_errors.length === 0 ? (
          <p className="text-xs text-[#1D9E75]">✓ Nenhum erro nas últimas 24h</p>
        ) : (
          <div className="space-y-3">
            {recent_errors.map(e => (
              <div key={e.id} className="card-secondary p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                    style={{
                      background: e.status === 'DEAD' ? '#FCEBEB' : '#FAEEDA',
                      color: e.status === 'DEAD' ? '#A32D2D' : '#A06B0F',
                    }}
                  >
                    {e.status}
                  </span>
                  <span className="text-[10px] opacity-50">
                    {formatHora(e.updated_at)} · {e.action}
                    {e.entity_id ? ` · ${e.entity_id}` : ''}
                    {' · '}
                    Tentativas: {e.attempt_count}/{e.max_attempts}
                  </span>
                </div>
                <p className="text-xs opacity-70 break-words">{e.last_error || 'Erro desconhecido'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Estatísticas do Dia */}
      <div className="card p-4 rounded-lg">
        <h2 className="text-xs font-medium opacity-70 mb-3">ESTATÍSTICAS DO DIA</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <p className="text-[10px] opacity-50 mb-1">Items processados</p>
            <p className="text-sm font-medium">{stats_today.queue_done.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Items falhados</p>
            <p className="text-sm font-medium" style={{ color: stats_today.queue_failed > 0 ? '#EF9F27' : undefined }}>
              {stats_today.queue_failed.toLocaleString('pt-BR')}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Taxa de sucesso</p>
            <p className="text-sm font-medium">
              {stats_today.success_rate != null ? `${stats_today.success_rate}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Pedidos sincronizados</p>
            <p className="text-sm font-medium">{stats_today.pedidos_synced.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Escrows processados</p>
            <p className="text-sm font-medium">{stats_today.escrow_synced.toLocaleString('pt-BR')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
