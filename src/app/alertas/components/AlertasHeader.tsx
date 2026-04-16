'use client';

import type { PresetPeriodo, PeriodosCalculados } from '../lib/types';

interface LojaOption {
  nome_exibicao: string;
}

interface Props {
  preset: PresetPeriodo;
  onPresetChange: (p: PresetPeriodo) => void;
  loja: string;
  onLojaChange: (l: string) => void;
  lojas: LojaOption[];
  ordenarPor: 'score' | 'pecas' | 'faturamento';
  onOrdenarPorChange: (o: 'score' | 'pecas' | 'faturamento') => void;
  periodos: PeriodosCalculados;
  lastUpdated: Date | null;
}

const PRESETS: { key: PresetPeriodo; label: string; parcial?: boolean }[] = [
  { key: 'hoje', label: 'Hoje', parcial: true },
  { key: 'ontem', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '15d', label: '15 dias' },
  { key: 'mes', label: 'Mês atual' },
];

function formatHora(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function AlertasHeader({
  preset, onPresetChange, loja, onLojaChange, lojas,
  ordenarPor, onOrdenarPorChange, periodos, lastUpdated,
}: Props) {
  return (
    <div className="mb-6">
      {/* Título + status */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Alertas</span>
        </h1>
        {lastUpdated && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            🟢 Atualizado às {formatHora(lastUpdated)}
          </span>
        )}
      </div>

      {/* Filtros de período */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => onPresetChange(p.key)}
            className={`px-3 py-1.5 text-[10px] rounded-md transition-colors ${
              preset === p.key
                ? 'bg-[#378ADD] text-white'
                : 'border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {p.label}
            {p.parcial && preset === p.key && (
              <span className="ml-1 text-[8px] opacity-70">(parcial)</span>
            )}
          </button>
        ))}
      </div>

      {/* Loja + ordenação */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={loja}
          onChange={e => onLojaChange(e.target.value)}
          className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
        >
          <option value="">Todas as lojas</option>
          {lojas.map(l => (
            <option key={l.nome_exibicao} value={l.nome_exibicao}>{l.nome_exibicao}</option>
          ))}
        </select>

        <div className="flex-1" />

        <div className="flex gap-1">
          {([['score', '🎯 Score'], ['pecas', '📦 Peças'], ['faturamento', '💰 Fat.']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => onOrdenarPorChange(key)}
              className={`px-2 py-1 text-[10px] rounded-md ${
                ordenarPor === key ? 'bg-[#378ADD] text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Label do período */}
      <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
        📅 Comparando: {periodos.label}
      </p>
    </div>
  );
}
