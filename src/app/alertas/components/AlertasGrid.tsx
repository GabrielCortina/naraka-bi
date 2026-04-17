'use client';

import { useState } from 'react';
import type { Alerta, AlertaResumo } from '../lib/types';
import { AlertaCard } from './AlertaCard';
import { AlertasResumo } from './AlertasResumo';

interface Props {
  quedas: Alerta[];
  picos: Alerta[];
  resumo: AlertaResumo[];
  loading: boolean;
  onPin: (sku: string) => void;
  isPinToggling: (sku: string) => boolean;
  onCardClick?: (alerta: Alerta) => void;
  iaColumn: React.ReactNode;
}

function SkeletonCards() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => <div key={i} className="h-28 bg-current/5 rounded-lg" />)}
    </div>
  );
}

export function AlertasGrid({ quedas, picos, resumo, loading, onPin, isPinToggling, onCardClick, iaColumn }: Props) {
  const [mobileTab, setMobileTab] = useState<'quedas' | 'picos' | 'ia'>('quedas');
  const [showAllQuedas, setShowAllQuedas] = useState(false);
  const [showAllPicos, setShowAllPicos] = useState(false);

  const quedasVisiveis = showAllQuedas ? quedas : quedas.slice(0, 8);
  const picosVisiveis = showAllPicos ? picos : picos.slice(0, 8);

  const renderQuedas = () => (
    <div>
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>
        QUEDAS ({quedas.length})
      </h3>
      <AlertasResumo resumo={resumo} tipo="QUEDA" />
      {loading ? <SkeletonCards /> : (
        <div className="space-y-3">
          {quedasVisiveis.map(a => (
            <AlertaCard key={a.sku_pai} alerta={a} onPin={onPin} isPinToggling={isPinToggling(a.sku_pai)} onClick={onCardClick ? () => onCardClick(a) : undefined} />
          ))}
          {quedas.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Nenhuma queda detectada</p>}
          {quedas.length > 8 && !showAllQuedas && (
            <button onClick={() => setShowAllQuedas(true)} className="text-[10px] text-[#378ADD] hover:underline">
              Ver todos ({quedas.length}) →
            </button>
          )}
          {showAllQuedas && quedas.length > 8 && (
            <button onClick={() => setShowAllQuedas(false)} className="text-[10px] text-[#378ADD] hover:underline">
              ver menos · top 8
            </button>
          )}
        </div>
      )}
    </div>
  );

  const renderPicos = () => (
    <div>
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-500"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
        PICOS ({picos.length})
      </h3>
      <AlertasResumo resumo={resumo} tipo="PICO" />
      {loading ? <SkeletonCards /> : (
        <div className="space-y-3">
          {picosVisiveis.map(a => (
            <AlertaCard key={a.sku_pai} alerta={a} onPin={onPin} isPinToggling={isPinToggling(a.sku_pai)} onClick={onCardClick ? () => onCardClick(a) : undefined} />
          ))}
          {picos.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">Nenhum pico detectado</p>}
          {picos.length > 8 && !showAllPicos && (
            <button onClick={() => setShowAllPicos(true)} className="text-[10px] text-[#378ADD] hover:underline">
              Ver todos ({picos.length}) →
            </button>
          )}
          {showAllPicos && picos.length > 8 && (
            <button onClick={() => setShowAllPicos(false)} className="text-[10px] text-[#378ADD] hover:underline">
              ver menos · top 8
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: tabs */}
      <div className="lg:hidden mb-3">
        <div className="flex gap-1">
          {([['quedas', `Quedas (${quedas.length})`], ['picos', `Picos (${picos.length})`], ['ia', 'IA']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobileTab(key)}
              className={`px-3 py-1.5 text-[10px] rounded-md transition-colors ${
                mobileTab === key
                  ? 'bg-[#378ADD] text-white'
                  : 'opacity-50 hover:opacity-80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile: conteúdo da tab ativa */}
      <div className="lg:hidden">
        {mobileTab === 'quedas' && renderQuedas()}
        {mobileTab === 'picos' && renderPicos()}
        {mobileTab === 'ia' && iaColumn}
      </div>

      {/* Desktop: 3 colunas */}
      <div className="hidden lg:grid lg:grid-cols-3 gap-4">
        <div>{renderQuedas()}</div>
        <div>{renderPicos()}</div>
        <div>{iaColumn}</div>
      </div>
    </>
  );
}
