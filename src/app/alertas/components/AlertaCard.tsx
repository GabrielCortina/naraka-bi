'use client';

import type { Alerta } from '../lib/types';
import { AlertaBreakdown } from './AlertaBreakdown';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  alerta: Alerta;
  onPin: (sku: string) => void;
  isPinToggling: boolean;
  onClick?: () => void;
}

const SEV_STYLES = {
  QUEDA: {
    ALTA:     'bg-red-500/10 dark:bg-red-500/15 border-red-500/30',
    MODERADA: 'bg-orange-500/10 dark:bg-orange-500/15 border-orange-500/30',
    LEVE:     'bg-yellow-500/8 dark:bg-yellow-500/12 border-yellow-500/25',
  },
  PICO: {
    ALTA:     'bg-green-500/10 dark:bg-green-500/15 border-green-500/30',
    MODERADA: 'bg-lime-500/10 dark:bg-lime-500/15 border-lime-500/30',
    LEVE:     'bg-emerald-500/8 dark:bg-emerald-500/12 border-emerald-500/25',
  },
} as const;

const BADGE_STYLES = {
  QUEDA: {
    ALTA:     'bg-red-900/40 text-red-300 dark:bg-red-900/60 dark:text-red-200',
    MODERADA: 'bg-orange-900/40 text-orange-300 dark:bg-orange-900/60 dark:text-orange-200',
    LEVE:     'bg-yellow-900/40 text-yellow-300 dark:bg-yellow-900/60 dark:text-yellow-200',
  },
  PICO: {
    ALTA:     'bg-green-900/40 text-green-300 dark:bg-green-900/60 dark:text-green-200',
    MODERADA: 'bg-lime-900/40 text-lime-300 dark:bg-lime-900/60 dark:text-lime-200',
    LEVE:     'bg-emerald-900/40 text-emerald-300 dark:bg-emerald-900/60 dark:text-emerald-200',
  },
} as const;

export function AlertaCard({ alerta, onPin, isPinToggling, onClick }: Props) {
  const a = alerta;
  const cardStyle = SEV_STYLES[a.tipo][a.severidade];
  const badgeStyle = BADGE_STYLES[a.tipo][a.severidade];
  const isQueda = a.tipo === 'QUEDA';
  const arrow = isQueda ? '↘' : '↗';
  const sign = isQueda ? '' : '+';
  const varColor = isQueda ? 'text-red-400' : 'text-green-400';

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors hover:brightness-110 ${cardStyle}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium font-mono">#{a.sku_pai}</span>
        <button
          onClick={e => { e.stopPropagation(); onPin(a.sku_pai); }}
          disabled={isPinToggling}
          className={`text-sm transition-opacity ${a.is_pinado ? 'opacity-100' : 'opacity-30 hover:opacity-60'}`}
          title={a.is_pinado ? 'Remover monitoramento' : 'Monitorar SKU'}
        >
          📌
        </button>
      </div>

      {/* Badge + variação */}
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badgeStyle}`}>
          {a.severidade}
        </span>
        <span className={`text-sm font-medium ${varColor}`}>
          {arrow} {sign}{a.variacao_pct}%
        </span>
      </div>

      {/* Impactos */}
      <div className="flex items-center gap-4 text-xs">
        <span className={`font-medium ${varColor}`}>
          {sign}{formatBRL(a.delta_faturamento)}
        </span>
        <span className="opacity-60">
          {sign}{a.delta_pecas.toLocaleString('pt-BR')} pç
        </span>
      </div>

      {/* Breakdown */}
      <AlertaBreakdown breakdown={a.breakdown_lojas} tipo={a.tipo} />
    </div>
  );
}
