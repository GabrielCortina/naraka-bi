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
  horaCorte: number | null;
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
  ordenarPor, onOrdenarPorChange, periodos, horaCorte, lastUpdated,
}: Props) {
  return (
    <div className="mb-6">
      {/* Título + status */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">
            NARAKA | <span className="text-[#378ADD]">Alertas</span>
          </h1>
          <p className="text-xs mt-0.5 text-gray-400 dark:text-gray-500">
            {lastUpdated
              ? <>Atualizado às {formatHora(lastUpdated)}</>
              : 'Carregando...'
            }
          </p>
        </div>
      </div>

      {/* Filtros — mesmo layout do Dashboard */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => onPresetChange(p.key)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              preset === p.key
                ? 'bg-[#378ADD] text-white'
                : 'border border-current/10 hover:border-current/30'
            }`}
          >
            {p.label}
            {p.parcial && preset === p.key && (
              <span className="ml-1 text-[10px] opacity-70">(parcial)</span>
            )}
          </button>
        ))}

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

        <div className="w-px h-6 bg-current/10 mx-1" />

        <div className="flex gap-1">
          {([['score', 'Score'], ['pecas', 'Peças'], ['faturamento', 'Fat.']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => onOrdenarPorChange(key)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                ordenarPor === key
                  ? 'bg-[#378ADD] text-white'
                  : 'border border-current/10 hover:border-current/30'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Label do período */}
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
        Comparando: {preset === 'hoje' && horaCorte != null
          ? `Hoje até ${horaCorte}h vs Ontem até ${horaCorte}h`
          : periodos.label
        }
      </p>
    </div>
  );
}
