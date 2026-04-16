'use client';

import type { BreakdownLoja } from '../lib/types';

interface Props {
  breakdown: BreakdownLoja[];
  tipo: 'PICO' | 'QUEDA';
  maxLojas?: number;
}

export function AlertaBreakdown({ breakdown, tipo, maxLojas = 3 }: Props) {
  const sorted = [...breakdown]
    .filter(b => b.delta_pecas !== 0)
    .sort((a, b) => Math.abs(b.delta_pecas) - Math.abs(a.delta_pecas));

  if (sorted.length === 0) return null;

  const visivel = sorted.slice(0, maxLojas);
  const restantes = sorted.length - maxLojas;
  const maxDelta = Math.max(...sorted.map(b => Math.abs(b.delta_pct ?? 0)), 1);

  const barColor = tipo === 'QUEDA'
    ? 'bg-red-500/60 dark:bg-red-400/50'
    : 'bg-green-500/60 dark:bg-green-400/50';

  return (
    <div className="mt-2 pt-2 border-t border-current/5 space-y-1.5">
      {visivel.map(b => {
        const pct = Math.min(Math.abs(b.delta_pct ?? 0) / maxDelta * 100, 100);
        return (
          <div key={b.loja} className="flex items-center gap-2 text-[10px]">
            <span className="w-[70px] truncate opacity-60">{b.loja}</span>
            <div className="flex-1 h-1 rounded-full bg-current/5 overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-[35px] text-right opacity-70">
              {b.delta_pct != null ? `${b.delta_pct > 0 ? '+' : ''}${b.delta_pct}%` : '—'}
            </span>
          </div>
        );
      })}
      {restantes > 0 && (
        <p className="text-[9px] opacity-40">+{restantes} {restantes === 1 ? 'loja' : 'lojas'}</p>
      )}
    </div>
  );
}
