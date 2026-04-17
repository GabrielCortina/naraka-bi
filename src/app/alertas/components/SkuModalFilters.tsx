'use client';

import { useRef, useState, useEffect } from 'react';
import type { PeriodoPreset, Marketplace } from '../hooks/useSkuModal';
import { getMarketplace } from '../hooks/useSkuModal';

interface Props {
  periodo: PeriodoPreset;
  onPeriodoChange: (p: PeriodoPreset) => void;
  customInicio: string | null;
  customFim: string | null;
  onCustomInicioChange: (v: string | null) => void;
  onCustomFimChange: (v: string | null) => void;
  lojasSelecionadas: string[];
  onLojasChange: (l: string[]) => void;
  marketplace: Marketplace | null;
  onMarketplaceChange: (m: Marketplace | null) => void;
  lojasDisponiveis: string[];
}

const PRESETS: { key: PeriodoPreset; lineA: string; lineB: string }[] = [
  { key: '30d',    lineA: '30',     lineB: 'dias' },
  { key: '7d',     lineA: '7',      lineB: 'dias' },
  { key: 'mes',    lineA: 'Mês',    lineB: 'atual' },
  { key: 'custom', lineA: 'Custom', lineB: 'período' },
];

const MKP_OPTIONS: Marketplace[] = ['Mercado Livre', 'Shopee', 'TikTok', 'Shein'];

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [onClose]);
  return ref;
}

function LojasDropdown({
  lojasSelecionadas, onChange, lojasDisponiveis, marketplace,
}: {
  lojasSelecionadas: string[];
  onChange: (l: string[]) => void;
  lojasDisponiveis: string[];
  marketplace: Marketplace | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  const lojasFiltradas = marketplace
    ? lojasDisponiveis.filter(l => getMarketplace(l) === marketplace)
    : lojasDisponiveis;

  const label = lojasSelecionadas.length === 0
    ? 'Todas lojas'
    : lojasSelecionadas.length === 1
      ? lojasSelecionadas[0]
      : `${lojasSelecionadas.length} lojas`;

  const todasMarcadas = lojasFiltradas.length > 0 &&
    lojasFiltradas.every(l => lojasSelecionadas.includes(l));

  const toggleTodas = () => {
    if (todasMarcadas) {
      onChange(lojasSelecionadas.filter(l => !lojasFiltradas.includes(l)));
    } else {
      const novas = Array.from(new Set([...lojasSelecionadas, ...lojasFiltradas]));
      onChange(novas);
    }
  };

  const toggleLoja = (loja: string) => {
    onChange(
      lojasSelecionadas.includes(loja)
        ? lojasSelecionadas.filter(l => l !== loja)
        : [...lojasSelecionadas, loja],
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-current/10 bg-transparent hover:border-current/30"
      >
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 right-0 mt-1 w-56 max-h-64 overflow-y-auto rounded-md border border-current/10 shadow-lg dark:bg-[#0f1117] bg-white">
          <label className="flex items-center gap-2 px-3 py-2 text-[11px] font-medium cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 border-b border-current/10">
            <input type="checkbox" checked={todasMarcadas} onChange={toggleTodas} />
            Todas {marketplace ? `(${marketplace})` : ''}
          </label>
          {lojasFiltradas.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-gray-500">Nenhuma loja</div>
          ) : (
            lojasFiltradas.map(l => (
              <label key={l} className="flex items-center gap-2 px-3 py-1.5 text-[11px] cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={lojasSelecionadas.includes(l)}
                  onChange={() => toggleLoja(l)}
                />
                {l}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MarketplaceDropdown({
  marketplace, onChange,
}: {
  marketplace: Marketplace | null;
  onChange: (m: Marketplace | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-md border border-current/10 bg-transparent hover:border-current/30"
      >
        <span>{marketplace ?? 'Todos MKP'}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-50 right-0 mt-1 w-48 rounded-md border border-current/10 shadow-lg dark:bg-[#0f1117] bg-white">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/5 ${marketplace === null ? 'text-[#378ADD] font-medium' : ''}`}
          >
            Todos MKP
          </button>
          {MKP_OPTIONS.map(m => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-black/5 dark:hover:bg-white/5 ${marketplace === m ? 'text-[#378ADD] font-medium' : ''}`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SkuModalFilters({
  periodo, onPeriodoChange,
  customInicio, customFim, onCustomInicioChange, onCustomFimChange,
  lojasSelecionadas, onLojasChange,
  marketplace, onMarketplaceChange,
  lojasDisponiveis,
}: Props) {
  return (
    <div className="space-y-2 mb-5">
      <div className="flex items-center gap-2 flex-wrap">
        {PRESETS.map(p => {
          const active = periodo === p.key;
          return (
            <button
              key={p.key}
              onClick={() => onPeriodoChange(p.key)}
              className={`flex flex-col items-center justify-center px-2.5 py-1 text-[11px] leading-tight rounded-md min-w-[46px] transition-colors ${
                active
                  ? 'bg-[#378ADD] text-white'
                  : 'border border-current/10 hover:border-current/30'
              }`}
            >
              <span className="font-medium">{p.lineA}</span>
              <span className="text-[9px] opacity-80">{p.lineB}</span>
            </button>
          );
        })}

        <div className="w-px h-7 bg-current/10 mx-1" />

        <LojasDropdown
          lojasSelecionadas={lojasSelecionadas}
          onChange={onLojasChange}
          lojasDisponiveis={lojasDisponiveis}
          marketplace={marketplace}
        />
        <MarketplaceDropdown
          marketplace={marketplace}
          onChange={onMarketplaceChange}
        />
      </div>

      {periodo === 'custom' && (
        <div className="flex items-center gap-2 pt-1">
          <input
            type="date"
            value={customInicio ?? ''}
            onChange={e => onCustomInicioChange(e.target.value || null)}
            className="px-2.5 py-1.5 text-[11px] rounded-md border border-current/10 bg-transparent"
          />
          <span className="text-[11px] text-gray-400">até</span>
          <input
            type="date"
            value={customFim ?? ''}
            onChange={e => onCustomFimChange(e.target.value || null)}
            className="px-2.5 py-1.5 text-[11px] rounded-md border border-current/10 bg-transparent"
          />
        </div>
      )}
    </div>
  );
}
