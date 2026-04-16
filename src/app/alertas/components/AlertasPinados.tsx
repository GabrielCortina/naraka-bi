'use client';

import type { PinadoStatus } from '../lib/types';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  pinados: PinadoStatus[];
  loading: boolean;
}

export function AlertasPinados({ pinados, loading }: Props) {
  if (loading) {
    return (
      <div className="card p-4 rounded-lg mb-4 animate-pulse">
        <div className="h-16 bg-current/5 rounded" />
      </div>
    );
  }

  if (pinados.length === 0) return null;

  return (
    <div className="card p-4 rounded-lg mb-4">
      <h3 className="text-xs font-medium opacity-70 mb-3">
        📌 MONITORADOS ({pinados.length})
      </h3>
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
              className={`card-secondary rounded-md p-2.5 border-l-[3px] ${borderColor}`}
            >
              <p className="text-xs font-medium font-mono mb-1">#{p.sku_pai}</p>
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
    </div>
  );
}
