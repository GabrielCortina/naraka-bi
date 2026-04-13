'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';

interface PollingLog {
  id: number;
  camada: string;
  iniciado_em: string;
  finalizado_em: string | null;
  duracao_ms: number | null;
  pedidos_processados: number;
  pedidos_erro: number;
  status: string;
  erro_mensagem: string | null;
}

interface ReconciliacaoRelatorio {
  id: number;
  iniciada_em: string;
  finalizada_em: string | null;
  status: 'em_andamento' | 'concluida' | 'interrompida';
  pedidos_varridos: number;
  pedidos_divergentes: number;
  pedidos_corrigidos: number;
  pedidos_faltaram: number;
  dias_processados: number;
  dias_total: number;
  observacao: string | null;
}

interface StatEntry {
  status: string;
  pedidos_processados: number;
  duracao_ms: number | null;
  camada: string;
}

interface CamadaStatus {
  camada: string;
  label: string;
  status: 'ok' | 'atencao' | 'erro' | 'sem_dados';
  ultimoLog: PollingLog | null;
}

const STATUS_CONFIG = {
  ok: { cor: '#1D9E75', label: 'OK', bg: '#E1F5EE' },
  atencao: { cor: '#EF9F27', label: 'ATENÇÃO', bg: '#FAEEDA' },
  erro: { cor: '#E24B4A', label: 'ERRO', bg: '#FCEBEB' },
  sem_dados: { cor: '#888', label: 'SEM DADOS', bg: '#F1EFE8' },
};

const INTERVALO_ESPERADO: Record<string, number> = {
  rapido: 10,
  status: 20,
  retry: 10,
  webhook: 60,
  reconciliacao: 1500,
};

const CAMADA_LABELS: Record<string, string> = {
  rapido: 'Rápido',
  status: 'Status',
  retry: 'Retry Queue',
  reconciliacao: 'Reconciliação',
  webhook: 'Webhook',
};

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatHoraComData(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDuracao(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}

function StatusBadge({ status }: { status: 'ok' | 'atencao' | 'erro' | 'sem_dados' }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: cfg.bg, color: cfg.cor }}>
      {cfg.label}
    </span>
  );
}

function LogStatusIcon({ status }: { status: string }) {
  if (status === 'success') return <span className="text-[#1D9E75]">✓</span>;
  if (status === 'error') return <span className="text-[#E24B4A]">✗</span>;
  if (status === 'timeout') return <span className="text-[#EF9F27]">⏱</span>;
  return <span className="text-[#378ADD]">⟳</span>;
}

// Início do dia no fuso local
function inicioDiaLocal(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
}

export default function SistemaApiPage() {
  const [logs, setLogs] = useState<PollingLog[]>([]);
  const [erros, setErros] = useState<PollingLog[]>([]);
  const [camadas, setCamadas] = useState<CamadaStatus[]>([]);
  const [statsHoje, setStatsHoje] = useState<StatEntry[]>([]);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const [tinyConnected, setTinyConnected] = useState(false);
  const [tinyExpiry, setTinyExpiry] = useState<string | null>(null);
  const [ultimoRelatorio, setUltimoRelatorio] = useState<ReconciliacaoRelatorio | null>(null);

  const fetchData = useCallback(async () => {
    const db = createBrowserClient();
    const inicioDia = inicioDiaLocal();

    // Busca em paralelo: últimas execuções, erros 24h, stats do dia, último de cada camada, status Tiny
    const [logsRes, errosRes, statsRes, statusRes, relatorioRes, ...ultimosRes] = await Promise.all([
      db.from('polling_logs').select('*').order('iniciado_em', { ascending: false }).limit(50),
      db.from('polling_logs').select('*')
        .in('status', ['error', 'timeout'])
        .gte('iniciado_em', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('iniciado_em', { ascending: false }),
      db.from('polling_logs').select('status, pedidos_processados, duracao_ms, camada')
        .gte('iniciado_em', inicioDia),
      fetch('/api/status').then(r => r.json()).catch(() => null),
      db.from('reconciliacao_relatorio').select('*')
        .order('iniciada_em', { ascending: false }).limit(1).maybeSingle(),
      // Último log de cada camada
      ...['rapido', 'status', 'retry', 'reconciliacao', 'webhook'].map(camada =>
        db.from('polling_logs').select('*').eq('camada', camada)
          .order('iniciado_em', { ascending: false }).limit(1).single()
      ),
    ]);

    setLogs(logsRes.data || []);
    setErros(errosRes.data || []);
    setStatsHoje(statsRes.data || []);
    setUltimoRelatorio(relatorioRes.data || null);

    if (statusRes?.tiny) {
      setTinyConnected(statusRes.tiny.connected);
      setTinyExpiry(statusRes.tiny.expiresAt);
    }

    // Monta status de cada camada a partir do último log individual
    const camadaNames = ['rapido', 'status', 'retry', 'reconciliacao', 'webhook'];
    const camadaStatuses: CamadaStatus[] = camadaNames.map((camada, i) => {
      const ultimoLog = ultimosRes[i]?.data as PollingLog | null;
      const label = CAMADA_LABELS[camada] || camada;

      if (!ultimoLog) {
        return { camada, label, status: 'sem_dados' as const, ultimoLog: null };
      }

      const minutosAtras = (Date.now() - new Date(ultimoLog.iniciado_em).getTime()) / 60000;
      const esperado = INTERVALO_ESPERADO[camada] || 10;

      let st: 'ok' | 'atencao' | 'erro' = 'ok';
      if (ultimoLog.status === 'error' || ultimoLog.status === 'timeout') {
        st = 'erro';
      } else if (minutosAtras > esperado) {
        st = 'atencao';
      }

      return { camada, label, status: st, ultimoLog };
    });

    setCamadas(camadaStatuses);
    setLastCheck(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Estatísticas do dia (calculadas a partir de statsHoje)
  const execucoesHoje = statsHoje.length;
  const sucessoHoje = statsHoje.filter(l => l.status === 'success').length;
  const errosHoje = statsHoje.filter(l => l.status === 'error' || l.status === 'timeout').length;
  const pedidosHoje = statsHoje.reduce((s, l) => s + (l.pedidos_processados || 0), 0);
  const tempoMedio = execucoesHoje > 0
    ? Math.round(statsHoje.reduce((s, l) => s + (l.duracao_ms || 0), 0) / execucoesHoje)
    : 0;
  const taxaSucesso = execucoesHoje > 0 ? ((sucessoHoje / execucoesHoje) * 100).toFixed(1) : '—';

  // Breakdown por camada
  const porCamada = ['rapido', 'status', 'retry', 'webhook', 'reconciliacao'].map(c => ({
    camada: c,
    label: CAMADA_LABELS[c] || c,
    count: statsHoje.filter(l => l.camada === c).length,
  })).filter(c => c.count > 0);

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">API & Monitoramento</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Última verificação: {formatHora(lastCheck.toISOString())} · auto-refresh 30s
        </p>
      </div>

      {/* Status Geral */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">STATUS GERAL</h2>
        <div className="space-y-2">
          {/* Tiny ERP */}
          <div className="flex items-center justify-between py-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ background: tinyConnected ? '#1D9E75' : '#E24B4A' }} />
              <span className="text-xs">Conexão Tiny ERP</span>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={tinyConnected ? 'ok' : 'erro'} />
              {tinyExpiry && (
                <span className="text-[10px] opacity-40">
                  Token expira: {new Date(tinyExpiry).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
          </div>

          {/* Camadas */}
          {camadas.map(c => (
            <div key={c.camada} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[c.status].cor }} />
                <span className="text-xs">{c.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={c.status} />
                {c.ultimoLog ? (
                  <span className="text-[10px] opacity-40">
                    Último: {c.camada === 'reconciliacao'
                      ? formatHoraComData(c.ultimoLog.iniciado_em)
                      : formatHora(c.ultimoLog.iniciado_em)}
                  </span>
                ) : (
                  <span className="text-[10px] opacity-30">Nunca executou</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Últimas Execuções */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ÚLTIMAS EXECUÇÕES</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left opacity-50">
              <th className="pb-2">Camada</th>
              <th className="pb-2">Início</th>
              <th className="pb-2 text-right">Duração</th>
              <th className="pb-2 text-right">Pedidos</th>
              <th className="pb-2 text-right">Status</th>
            </tr></thead>
            <tbody>
              {logs.slice(0, 20).map(log => (
                <tr key={log.id} className="border-t border-current/5">
                  <td className="py-1.5">{CAMADA_LABELS[log.camada] || log.camada}</td>
                  <td className="py-1.5">{formatHora(log.iniciado_em)}</td>
                  <td className="py-1.5 text-right">{formatDuracao(log.duracao_ms)}</td>
                  <td className="py-1.5 text-right">{log.pedidos_processados.toLocaleString('pt-BR')}</td>
                  <td className="py-1.5 text-right">
                    <LogStatusIcon status={log.status} />
                    <span className="ml-1">{log.status === 'success' ? 'OK' : log.status.toUpperCase()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Erros Recentes */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ERROS RECENTES (últimas 24h)</h2>
        {erros.length === 0 ? (
          <p className="text-xs text-[#1D9E75]">✓ Nenhum erro nas últimas 24h</p>
        ) : (
          <div className="space-y-3">
            {erros.map(e => (
              <div key={e.id} className="card-secondary p-3 rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#FCEBEB', color: '#A32D2D' }}>ERRO</span>
                  <span className="text-[10px] opacity-50">{formatHora(e.iniciado_em)} · {CAMADA_LABELS[e.camada] || e.camada}</span>
                </div>
                <p className="text-xs opacity-70">{e.erro_mensagem || 'Erro desconhecido'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Último Relatório de Reconciliação */}
      <div className="card p-4 rounded-lg mb-4">
        <h2 className="text-xs font-medium opacity-70 mb-3">ULTIMO RELATORIO DE RECONCILIACAO</h2>
        {!ultimoRelatorio ? (
          <p className="text-xs opacity-40">Nenhum relatorio encontrado</p>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded" style={{
                background: ultimoRelatorio.status === 'concluida' ? '#E1F5EE'
                  : ultimoRelatorio.status === 'interrompida' ? '#FAEEDA'
                  : '#E8F0FE',
                color: ultimoRelatorio.status === 'concluida' ? '#1D9E75'
                  : ultimoRelatorio.status === 'interrompida' ? '#EF9F27'
                  : '#378ADD',
              }}>
                {ultimoRelatorio.status === 'concluida' ? 'CONCLUIDA'
                  : ultimoRelatorio.status === 'interrompida' ? 'INTERROMPIDA'
                  : 'EM ANDAMENTO'}
              </span>
              <span className="text-[10px] opacity-40">
                {formatHoraComData(ultimoRelatorio.iniciada_em)}
                {ultimoRelatorio.finalizada_em && ` — ${formatHoraComData(ultimoRelatorio.finalizada_em)}`}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
              <div>
                <p className="text-[10px] opacity-50 mb-1">Pedidos varridos</p>
                <p className="text-sm font-medium">{ultimoRelatorio.pedidos_varridos.toLocaleString('pt-BR')}</p>
              </div>
              <div>
                <p className="text-[10px] opacity-50 mb-1">Divergentes</p>
                <p className="text-sm font-medium">{ultimoRelatorio.pedidos_divergentes.toLocaleString('pt-BR')}</p>
              </div>
              <div>
                <p className="text-[10px] opacity-50 mb-1">Corrigidos</p>
                <p className="text-sm font-medium" style={{ color: ultimoRelatorio.pedidos_corrigidos > 0 ? '#1D9E75' : undefined }}>
                  {ultimoRelatorio.pedidos_corrigidos.toLocaleString('pt-BR')}
                </p>
              </div>
              <div>
                <p className="text-[10px] opacity-50 mb-1">Faltaram</p>
                <p className="text-sm font-medium" style={{ color: ultimoRelatorio.pedidos_faltaram > 0 ? '#E24B4A' : undefined }}>
                  {ultimoRelatorio.pedidos_faltaram.toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2 border-t border-current/5">
              <span className="text-[10px] opacity-50">
                Dias processados: <span className="font-medium opacity-100">{ultimoRelatorio.dias_processados}/{ultimoRelatorio.dias_total}</span>
              </span>
              {ultimoRelatorio.observacao && (
                <span className="text-[10px] opacity-40">{ultimoRelatorio.observacao}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Estatísticas do Dia */}
      <div className="card p-4 rounded-lg">
        <h2 className="text-xs font-medium opacity-70 mb-3">ESTATÍSTICAS DO DIA</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <p className="text-[10px] opacity-50 mb-1">Execuções hoje</p>
            <p className="text-sm font-medium">{execucoesHoje} <span className="text-[10px] opacity-40">({sucessoHoje} ok · {errosHoje} erro)</span></p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Pedidos sincronizados</p>
            <p className="text-sm font-medium">{pedidosHoje.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Tempo médio</p>
            <p className="text-sm font-medium">{formatDuracao(tempoMedio)}</p>
          </div>
          <div>
            <p className="text-[10px] opacity-50 mb-1">Taxa de sucesso</p>
            <p className="text-sm font-medium">{taxaSucesso}%</p>
          </div>
        </div>

        {/* Breakdown por camada */}
        {porCamada.length > 0 && (
          <div className="flex flex-wrap gap-3 pt-3 border-t border-current/5">
            {porCamada.map(c => (
              <span key={c.camada} className="text-[10px] opacity-50">
                {c.label} <span className="font-medium opacity-100">{c.count}</span> exec
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
