'use client';

import type { Alerta } from '../lib/types';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  alerta: Alerta;
  onClose: () => void;
}

const BADGE_TIPO = {
  PICO:  'bg-green-500/20 text-green-300 dark:bg-green-500/20 dark:text-green-300',
  QUEDA: 'bg-red-500/20 text-red-300 dark:bg-red-500/20 dark:text-red-300',
} as const;

const BADGE_SEV = {
  ALTA:     'bg-red-200/30 text-red-500 dark:bg-red-500/25 dark:text-red-300',
  MODERADA: 'bg-orange-200/30 text-orange-500 dark:bg-orange-500/25 dark:text-orange-300',
  LEVE:     'bg-blue-200/30 text-blue-500 dark:bg-blue-500/25 dark:text-blue-300',
} as const;

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function SkuModalHeader({ alerta, onClose }: Props) {
  const isQueda = alerta.tipo === 'QUEDA';
  const varColor = isQueda ? 'text-red-500 dark:text-red-400' : 'text-green-600 dark:text-green-400';
  const arrow = isQueda ? '↘' : '↗';
  const sign = isQueda ? '' : '+';

  return (
    <div className="flex items-start justify-between p-5 border-b border-current/10">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-xl font-mono font-medium">#{alerta.sku_pai}</span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE_TIPO[alerta.tipo]}`}>
            {alerta.tipo}
          </span>
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE_SEV[alerta.severidade]}`}>
            {alerta.severidade}
          </span>
        </div>
        <div className="flex items-end gap-4 flex-wrap">
          <span className={`text-3xl font-medium ${varColor}`}>
            {arrow} {sign}{alerta.variacao_pct}%
          </span>
          <span className={`text-sm ${varColor}`}>
            {sign}{formatBRL(alerta.delta_faturamento)}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {sign}{alerta.delta_pecas.toLocaleString('pt-BR')} peças
          </span>
        </div>
      </div>

      <button
        onClick={onClose}
        className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
        title="Fechar"
        aria-label="Fechar modal"
      >
        <CloseIcon />
      </button>
    </div>
  );
}
