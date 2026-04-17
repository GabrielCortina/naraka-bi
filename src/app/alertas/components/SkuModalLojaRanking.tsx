'use client';

import type { LojaRow } from '../hooks/useSkuModal';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  dados: LojaRow[];
  loading: boolean;
}

function formatCurto(v: number): string {
  if (v >= 1000) return `R$${(v / 1000).toFixed(1)}k`;
  return formatBRL(v);
}

export function SkuModalLojaRanking({ dados, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5">
        <h3 className="text-xs font-medium opacity-70 mb-3">POR LOJA</h3>
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-6 bg-current/5 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const max = dados.reduce((m, d) => Math.max(m, d.faturamento), 0);

  return (
    <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5">
      <h3 className="text-xs font-medium opacity-70 mb-3">POR LOJA</h3>
      {dados.length === 0 ? (
        <p className="text-xs text-gray-500 py-8 text-center">Sem dados</p>
      ) : (
        <div className="space-y-2">
          {dados.map(d => {
            const pct = max > 0 ? (d.faturamento / max) * 100 : 0;
            const variacaoColor = d.variacaoPercent == null
              ? 'text-gray-400'
              : d.variacaoPercent >= 0
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-500 dark:text-red-400';
            const barColor = d.variacaoPercent == null
              ? '#888780'
              : d.variacaoPercent >= 0
                ? '#1D9E75'
                : '#E24B4A';
            const sign = d.variacaoPercent != null && d.variacaoPercent > 0 ? '+' : '';
            return (
              <div key={d.loja} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate" title={d.loja}>{d.loja}</span>
                <div className="flex-1 h-2 rounded-full bg-current/5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: barColor }}
                  />
                </div>
                <span className={`w-14 text-right font-medium ${variacaoColor}`}>
                  {d.variacaoPercent == null ? '—' : `${sign}${d.variacaoPercent.toFixed(1)}%`}
                </span>
                <span className="w-16 text-right text-[10px] text-gray-500 dark:text-gray-400">
                  {formatCurto(d.faturamento)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
