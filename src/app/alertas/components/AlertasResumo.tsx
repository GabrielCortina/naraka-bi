'use client';

import type { AlertaResumo } from '../lib/types';

interface Props {
  resumo: AlertaResumo[];
  tipo: 'QUEDA' | 'PICO';
}

const BADGE = {
  QUEDA: {
    ALTA:     'bg-red-900/40 text-red-300',
    MODERADA: 'bg-orange-900/40 text-orange-300',
    LEVE:     'bg-yellow-900/40 text-yellow-300',
  },
  PICO: {
    ALTA:     'bg-green-900/40 text-green-300',
    MODERADA: 'bg-lime-900/40 text-lime-300',
    LEVE:     'bg-emerald-900/40 text-emerald-300',
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
