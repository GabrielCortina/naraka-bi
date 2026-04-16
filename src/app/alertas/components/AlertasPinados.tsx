'use client';

import { useState } from 'react';
import type { PinadoStatus } from '../lib/types';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  pinados: PinadoStatus[];
  loading: boolean;
  onUnpin: (skuPai: string) => void;
  onPin: (skuPai: string) => void;
  isToggling: (skuPai: string) => boolean;
}

export function AlertasPinados({ pinados, loading, onUnpin, onPin, isToggling }: Props) {
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState('');

  function handleAddPin() {
    const val = search.trim();
    if (!val) return;
    if (pinados.some(p => p.sku_pai === val)) {
      setFeedback('Ja monitorado');
      setTimeout(() => setFeedback(''), 2000);
      return;
    }
    onPin(val);
    setSearch('');
  }

  if (loading) {
    return (
      <div className="card p-4 rounded-lg mb-4 animate-pulse">
        <div className="h-16 bg-current/5 rounded" />
      </div>
    );
  }

  return (
    <div className="card p-4 rounded-lg mb-4">
      <h3 className="text-xs font-medium opacity-70 mb-3">
        📌 MONITORADOS ({pinados.length})
      </h3>

      {/* Busca para pinar */}
      <div className="flex items-center gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddPin()}
          placeholder="Buscar SKU para monitorar..."
          className="px-2.5 py-1.5 text-xs rounded border border-current/10 bg-transparent w-48"
        />
        <button
          onClick={handleAddPin}
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-current/10 hover:bg-current/5"
        >
          +
        </button>
        {feedback && <span className="text-[10px] text-yellow-500">{feedback}</span>}
      </div>

      {/* Cards */}
      {pinados.length === 0 ? (
        <p className="text-[10px] opacity-40">Nenhum SKU monitorado. Use a busca acima ou clique 📌 em um alerta.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
          {pinados.map(p => {
            const isQueda = p.tipo === 'QUEDA';
            const isPico = p.tipo === 'PICO';
            const borderColor = isQueda
              ? 'border-l-red-500'
              : isPico
                ? 'border-l-green-500'
                : 'border-l-gray-400 dark:border-l-gray-600';
            const varColor = isQueda ? 'text-red-400' : isPico ? 'text-green-400' : 'opacity-50';
            const arrow = isQueda ? '↘' : isPico ? '↗' : '→';
            const sign = isPico ? '+' : '';

            return (
              <div
                key={p.sku_pai}
                className={`card-secondary rounded-md p-2.5 border-l-[3px] ${borderColor} relative`}
              >
                <button
                  onClick={() => onUnpin(p.sku_pai)}
                  disabled={isToggling(p.sku_pai)}
                  className="absolute top-1.5 right-1.5 w-4 h-4 flex items-center justify-center text-[10px] opacity-30 hover:opacity-80 transition-opacity"
                  title="Remover monitoramento"
                >
                  ✕
                </button>
                <p className="text-xs font-medium font-mono mb-1 pr-4">#{p.sku_pai}</p>
                <p className={`text-xs font-medium ${varColor}`}>
                  {arrow} {sign}{p.variacao_pct}%
                </p>
                <p className={`text-[10px] ${varColor}`}>
                  {sign}{formatBRL(p.delta_faturamento)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
