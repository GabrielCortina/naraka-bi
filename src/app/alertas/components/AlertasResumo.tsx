'use client';

import type { AlertaResumo } from '../lib/types';

interface Props {
  resumo: AlertaResumo[];
  tipo: 'QUEDA' | 'PICO';
}

const BADGE = {
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

export function AlertasResumo({ resumo, tipo }: Props) {
  const items = resumo.filter(r => r.tipo === tipo);
  if (items.length === 0) return null;

  const order = ['ALTA', 'MODERADA', 'LEVE'] as const;
  const sorted = order
    .map(sev => items.find(i => i.severidade === sev))
    .filter(Boolean) as AlertaResumo[];

  return (
    <div className="flex gap-1.5 mb-3">
      {sorted.map(r => (
        <span
          key={r.severidade}
          className={`text-[10px] font-medium px-2 py-0.5 rounded ${BADGE[tipo][r.severidade as keyof (typeof BADGE)['QUEDA']]}`}
        >
          {r.severidade[0]}:{r.quantidade}
        </span>
      ))}
    </div>
  );
}
