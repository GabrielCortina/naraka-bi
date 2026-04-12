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

// Intervalos esperados por camada (em minutos)
const INTERVALO_ESPERADO: Record<string, number> = {
  rapido: 10,
  status: 20,
  reconciliacao: 1500, // ~25h
};

function calcularStatusCamada(camada: string, logs: PollingLog[]): CamadaStatus {
  const labels: Record<string, string> = {
    rapido: 'Polling Rápido',
    status: 'Polling Status',
    reconciliacao: 'Reconciliação',
  };

  const camadaLogs = logs.filter(l => l.camada === camada);
  if (camadaLogs.length === 0) {
    return { camada, label: labels[camada] || camada, status: 'sem_dados', ultimoLog: null };
  }

  const ultimo = camadaLogs[0]; // já ordenado DESC
  const minutosAtras = (Date.now() - new Date(ultimo.iniciado_em).getTime()) / 60000;
  const esperado = INTERVALO_ESPERADO[camada] || 10;

  let status: 'ok' | 'atencao' | 'erro' | 'sem_dados' = 'ok';
  if (ultimo.status === 'error' || ultimo.status === 'timeout') {
    status = 'erro';
  } else if (minutosAtras > esperado) {
    status = 'atencao';
  }

  return { camada, label: labels[camada] || camada, status, ultimoLog: ultimo };
}

function formatHora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

export default function SistemaApiPage() {
  const [logs, setLogs] = useState<PollingLog[]>([]);
  const [erros, setErros] = useState<PollingLog[]>([]);
  const [lastCheck, setLastCheck] = useState<Date>(new Date());
  const [tinyConnected, setTinyConnected] = useState(false);
  const [tinyExpiry, setTinyExpiry] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const db = createBrowserClient();

    const [logsRes, errosRes, statusRes] = await Promise.all([
      db.from('polling_logs').select('*').order('iniciado_em', { ascending: false }).limit(50),
      db.from('polling_logs').select('*')
        .in('status', ['error', 'timeout'])
        .gte('iniciado_em', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('iniciado_em', { ascending: false }),
      fetch('/api/status').then(r => r.json()).catch(() => null),
    ]);

    setLogs(logsRes.data || []);
    setErros(errosRes.data || []);
    if (statusRes?.tiny) {
      setTinyConnected(statusRes.tiny.connected);
      setTinyExpiry(statusRes.tiny.expiresAt);
    }
    setLastCheck(new Date());
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Status por camada
  const camadas: CamadaStatus[] = ['rapido', 'status', 'reconciliacao'].map(c => calcularStatusCamada(c, logs));

  // Estatísticas do dia
  const hojeStr = new Date().toISOString().split('T')[0];
  const logsHoje = logs.filter(l => l.iniciado_em >= hojeStr + 'T00:00:00');
  const execucoesHoje = logsHoje.length;
  const sucessoHoje = logsHoje.filter(l => l.status === 'success').length;
  const errosHoje = logsHoje.filter(l => l.status === 'error' || l.status === 'timeout').length;
  const pedidosHoje = logsHoje.reduce((s, l) => s + (l.pedidos_processados || 0), 0);
  const tempoMedio = execucoesHoje > 0
    ? Math.round(logsHoje.reduce((s, l) => s + (l.duracao_ms || 0), 0) / execucoesHoje)
    : 0;
  const taxaSucesso = execucoesHoje > 0 ? ((sucessoHoje / execucoesHoje) * 100).toFixed(1) : '—';

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

          {/* Camadas de polling */}
          {camadas.map(c => (
            <div key={c.camada} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_CONFIG[c.status].cor }} />
                <span className="text-xs">{c.label}</span>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={c.status} />
                {c.ultimoLog && (
                  <span className="text-[10px] opacity-40">
                    Último: {formatHora(c.ultimoLog.iniciado_em)}
                  </span>
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
                  <td className="py-1.5 capitalize">{log.camada === 'reconciliacao' ? 'Reconcil.' : log.camada === 'rapido' ? 'Rápido' : 'Status'}</td>
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
                  <span className="text-[10px] opacity-50">{formatHora(e.iniciado_em)} · {e.camada === 'rapido' ? 'Rápido' : e.camada === 'reconciliacao' ? 'Reconcil.' : 'Status'}</span>
                </div>
                <p className="text-xs opacity-70">{e.erro_mensagem || 'Erro desconhecido'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Estatísticas do Dia */}
      <div className="card p-4 rounded-lg">
        <h2 className="text-xs font-medium opacity-70 mb-3">ESTATÍSTICAS DO DIA</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </div>
    </div>
  );
}
