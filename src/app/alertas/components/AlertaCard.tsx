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
    ALTA:     'bg-red-50 border-red-300 dark:bg-red-500/15 dark:border-red-500/30',
    MODERADA: 'bg-orange-50 border-orange-300 dark:bg-orange-500/15 dark:border-orange-500/30',
    LEVE:     'bg-yellow-50 border-yellow-200 dark:bg-yellow-500/10 dark:border-yellow-500/25',
  },
  PICO: {
    ALTA:     'bg-green-50 border-green-300 dark:bg-green-500/15 dark:border-green-500/30',
    MODERADA: 'bg-lime-50 border-lime-300 dark:bg-lime-500/15 dark:border-lime-500/30',
    LEVE:     'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/25',
  },
} as const;

const BADGE_STYLES = {
  QUEDA: {
    ALTA:     'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
    MODERADA: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    LEVE:     'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  },
  PICO: {
    ALTA:     'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300',
    MODERADA: 'bg-lime-100 text-lime-700 dark:bg-lime-500/20 dark:text-lime-300',
    LEVE:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  },
} as const;

export function AlertaCard({ alerta, onPin, isPinToggling, onClick }: Props) {
  const a = alerta;
  const cardStyle = SEV_STYLES[a.tipo][a.severidade];
  const badgeStyle = BADGE_STYLES[a.tipo][a.severidade];
  const isQueda = a.tipo === 'QUEDA';
  const arrow = isQueda ? '↘' : '↗';
  const sign = isQueda ? '' : '+';
  const varColor = isQueda
    ? 'text-red-600 dark:text-red-400'
    : 'text-green-600 dark:text-green-400';

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer transition-colors hover:brightness-[1.02] dark:hover:brightness-110 ${cardStyle}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium font-mono text-gray-800 dark:text-gray-200">#{a.sku_pai}</span>
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
        <span className="text-gray-500 dark:text-gray-400">
          {sign}{a.delta_pecas.toLocaleString('pt-BR')} pç
        </span>
      </div>

      {/* Breakdown */}
      <AlertaBreakdown breakdown={a.breakdown_lojas} tipo={a.tipo} />
    </div>
  );
}
