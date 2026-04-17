'use client';

import { useMemo } from 'react';
import type {
  AlteracoesFiltros as FiltrosState,
  PresetPeriodoAlteracoes,
  TipoAlteracao,
} from '../lib/types';
import { TIPOS_ALTERACAO } from '../lib/types';

interface LojaOption {
  nome_exibicao: string;
}

interface Props {
  filtros: FiltrosState;
  onChange: (filtros: FiltrosState) => void;
  onLimpar: () => void;
  lojas: LojaOption[];
}

const PRESETS: { key: PresetPeriodoAlteracoes; label: string }[] = [
  { key: '7d', label: '7 dias' },
  { key: '15d', label: '15 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'mes', label: 'Mês atual' },
  { key: 'personalizado', label: 'Personalizado' },
];

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function fmtISO(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function calcularPreset(preset: PresetPeriodoAlteracoes): { inicio: string | null; fim: string | null } {
  if (preset === 'personalizado') return { inicio: null, fim: null };
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const fim = new Date(y, m, d);
  switch (preset) {
    case '7d':  return { inicio: fmtISO(new Date(y, m, d - 6)),  fim: fmtISO(fim) };
    case '15d': return { inicio: fmtISO(new Date(y, m, d - 14)), fim: fmtISO(fim) };
    case '30d': return { inicio: fmtISO(new Date(y, m, d - 29)), fim: fmtISO(fim) };
    case 'mes': return { inicio: fmtISO(new Date(y, m, 1)),      fim: fmtISO(fim) };
  }
}

function detectarPreset(filtros: FiltrosState): PresetPeriodoAlteracoes | null {
  if (!filtros.dataInicio || !filtros.dataFim) return null;
  for (const p of PRESETS) {
    if (p.key === 'personalizado') continue;
    const { inicio, fim } = calcularPreset(p.key);
    if (inicio === filtros.dataInicio && fim === filtros.dataFim) return p.key;
  }
  return 'personalizado';
}

export function AlteracoesFiltros({ filtros, onChange, onLimpar, lojas }: Props) {
  const presetAtivo = useMemo(() => detectarPreset(filtros), [filtros]);
  const temFiltro = filtros.dataInicio || filtros.dataFim || filtros.sku || filtros.tipo || filtros.loja;

  const aplicarPreset = (preset: PresetPeriodoAlteracoes) => {
    const { inicio, fim } = calcularPreset(preset);
    onChange({ ...filtros, dataInicio: inicio, dataFim: fim });
  };

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(p => (
          <button
            key={p.key}
            onClick={() => aplicarPreset(p.key)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              presetAtivo === p.key
                ? 'bg-[#378ADD] text-white'
                : 'border border-current/10 hover:border-current/30'
            }`}
          >
            {p.label}
          </button>
        ))}

        <div className="w-px h-6 bg-current/10 mx-1" />

        <input
          type="text"
          placeholder="Buscar SKU..."
          value={filtros.sku}
          onChange={e => onChange({ ...filtros, sku: e.target.value })}
          onKeyDown={e => { if (e.key === 'Enter') onChange({ ...filtros }); }}
          onBlur={() => onChange({ ...filtros })}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent placeholder:text-gray-400 w-32"
        />

        <select
          value={filtros.tipo}
          onChange={e => onChange({ ...filtros, tipo: e.target.value as TipoAlteracao | '' })}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent"
        >
          <option value="">Todos os tipos</option>
          {TIPOS_ALTERACAO.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select
          value={filtros.loja}
          onChange={e => onChange({ ...filtros, loja: e.target.value })}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent"
        >
          <option value="">Todas as lojas</option>
          {lojas.map(l => (
            <option key={l.nome_exibicao} value={l.nome_exibicao}>{l.nome_exibicao}</option>
          ))}
        </select>

        {temFiltro && (
          <button
            onClick={onLimpar}
            className="px-3 py-1.5 text-xs rounded-md text-gray-500 hover:text-current transition-colors"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {presetAtivo === 'personalizado' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={filtros.dataInicio ?? ''}
            onChange={e => onChange({ ...filtros, dataInicio: e.target.value || null })}
            className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent"
          />
          <span className="text-xs text-gray-400">até</span>
          <input
            type="date"
            value={filtros.dataFim ?? ''}
            onChange={e => onChange({ ...filtros, dataFim: e.target.value || null })}
            className="px-3 py-1.5 text-xs rounded-md border border-current/10 bg-transparent"
          />
        </div>
      )}
    </div>
  );
}
