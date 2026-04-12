'use client';

import type { PeriodFilter } from '../types';

interface LojaOption {
  nome_exibicao: string;
}

interface Props {
  filter: PeriodFilter;
  onFilterChange: (f: PeriodFilter) => void;
  loja: string;
  onLojaChange: (l: string) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (v: string) => void;
  onCustomEndChange: (v: string) => void;
  lojas: LojaOption[];
  onOpenConfig: () => void;
  refreshing: boolean;
  lastUpdated: Date | null;
}

const FILTERS: { value: PeriodFilter; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7dias', label: '7 dias' },
  { value: '15dias', label: '15 dias' },
  { value: 'mes_atual', label: 'Mês atual' },
  { value: 'mes_anterior', label: 'Mês anterior' },
  { value: 'personalizado', label: 'Personalizado' },
];

export function DashboardHeader({
  filter, onFilterChange, loja, onLojaChange,
  customStart, customEnd,
  onCustomStartChange, onCustomEndChange,
  lojas, onOpenConfig, refreshing, lastUpdated,
}: Props) {
  const timeStr = lastUpdated
    ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">
            NARAKA | <span className="text-[#378ADD]">Dashboard</span>
          </h1>
          <p className="text-xs mt-0.5 opacity-50">
            {refreshing ? (
              <span className="text-[#378ADD]">Atualizando...</span>
            ) : (
              <>Atualizado às {timeStr} · Tiny ERP sync</>
            )}
          </p>
        </div>
        <button
          onClick={onOpenConfig}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 hover:opacity-80 transition-opacity"
        >
          ⚙ Lojas
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              filter === f.value
                ? 'bg-[#378ADD] text-white'
                : 'border border-current/10 hover:border-current/30'
            }`}
          >
            {f.label}
          </button>
        ))}

        {filter === 'personalizado' && (
          <div className="flex items-center gap-1 ml-2">
            <input
              type="date"
              value={customStart}
              onChange={e => onCustomStartChange(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-current/10 bg-transparent"
            />
            <span className="text-xs opacity-50">até</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => onCustomEndChange(e.target.value)}
              className="px-2 py-1 text-xs rounded border border-current/10 bg-transparent"
            />
          </div>
        )}

        <div className="w-px h-6 bg-current/10 mx-1" />

        <select
          value={loja}
          onChange={e => onLojaChange(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent"
        >
          <option value="">Todas as lojas</option>
          {lojas.map(l => (
            <option key={l.nome_exibicao} value={l.nome_exibicao}>{l.nome_exibicao}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
