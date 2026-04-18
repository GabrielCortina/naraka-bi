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
  onCardClick?: (pinado: PinadoStatus) => void;
}

export function AlertasPinados({ pinados, loading, onUnpin, onPin, isToggling, onCardClick }: Props) {
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
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 002-2 2 2 0 00-2-2H8a2 2 0 00-2 2 2 2 0 002 2 1 1 0 011 1z"/></svg>
          MONITORADOS ({pinados.length})
        </h3>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddPin()}
            placeholder="+ SKU..."
            className="px-2 py-1 text-xs rounded border border-current/10 bg-transparent w-28 h-7"
          />
          <button
            onClick={handleAddPin}
            className="h-7 w-7 text-xs font-medium rounded border border-current/10 hover:bg-current/5 flex items-center justify-center"
          >
            +
          </button>
          {feedback && <span className="text-[10px] text-yellow-500 ml-1">{feedback}</span>}
        </div>
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
                onClick={onCardClick ? () => onCardClick(p) : undefined}
                className={`card-secondary rounded-md p-2.5 border-l-[3px] ${borderColor} relative ${onCardClick ? 'cursor-pointer transition-colors hover:brightness-[1.02] dark:hover:brightness-110' : ''}`}
              >
                <button
                  onClick={e => { e.stopPropagation(); onUnpin(p.sku_pai); }}
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
