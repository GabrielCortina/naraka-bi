'use client';

import { useEffect, useState, useCallback } from 'react';
import { StatusCard } from '@/components/status-card';

interface AppStatus {
  tiny: { connected: boolean; expiresAt: string | null };
  polling: {
    ultima_verificacao: string;
    pedidos_processados: number;
    status: string;
    erro_mensagem: string | null;
  } | null;
  pedidos: { total: number; ultimaSincronizacao: string | null };
}

export default function Home() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Falha ao buscar status');
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch {
      setError('Não foi possível conectar ao servidor. Verifique se o banco de dados está configurado.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Verifica query params de retorno do OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      fetchStatus();
      window.history.replaceState({}, '', '/');
    }
    if (params.get('error')) {
      setError(`Erro na autenticação: ${params.get('error')}`);
      window.history.replaceState({}, '', '/');
    }
  }, [fetchStatus]);

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight">naraka-bi</h1>
          <p className="text-zinc-400 mt-1">Business Intelligence para pedidos e-commerce</p>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-3 text-zinc-400">
            <div className="h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
            Carregando status...
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Status Cards */}
        {status && (
          <div className="grid gap-6 md:grid-cols-3">
            {/* Conexão Tiny */}
            <StatusCard
              title="Conexão Tiny ERP"
              value={status.tiny.connected ? 'Conectado' : 'Desconectado'}
              valueColor={status.tiny.connected ? 'text-emerald-400' : 'text-red-400'}
              detail={
                status.tiny.connected && status.tiny.expiresAt
                  ? `Token expira: ${new Date(status.tiny.expiresAt).toLocaleString('pt-BR')}`
                  : undefined
              }
              action={
                !status.tiny.connected
                  ? { label: 'Conectar com Tiny', href: '/api/auth/tiny/connect' }
                  : undefined
              }
            />

            {/* Total de Pedidos */}
            <StatusCard
              title="Pedidos no Banco"
              value={String(status.pedidos.total)}
              detail="Total de pedidos sincronizados"
            />

            {/* Última Sincronização */}
            <StatusCard
              title="Última Sincronização"
              value={
                status.pedidos.ultimaSincronizacao
                  ? formatDate(status.pedidos.ultimaSincronizacao)
                  : 'Nunca'
              }
              valueColor={
                status.polling?.status === 'error' ? 'text-red-400' :
                status.polling?.status === 'running' ? 'text-yellow-400' :
                'text-zinc-100'
              }
              detail={
                status.polling?.erro_mensagem
                  ? `Erro: ${status.polling.erro_mensagem}`
                  : status.polling
                    ? `${status.polling.pedidos_processados} pedidos no último ciclo`
                    : undefined
              }
            />
          </div>
        )}

        {/* Rodapé com info */}
        <div className="mt-12 pt-6 border-t border-zinc-800">
          <p className="text-xs text-zinc-500">
            O polling de pedidos é executado automaticamente via Vercel Cron Jobs.
            Para sincronizar manualmente, envie um POST para <code className="text-zinc-400">/api/polling</code>.
          </p>
        </div>
      </div>
    </main>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'Nunca';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
