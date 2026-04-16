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
  iaColumn: React.ReactNode;
}

function SkeletonCards() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map(i => <div key={i} className="h-28 bg-current/5 rounded-lg" />)}
    </div>
  );
}

export function AlertasGrid({ quedas, picos, resumo, loading, onPin, isPinToggling, iaColumn }: Props) {
  const [mobileTab, setMobileTab] = useState<'quedas' | 'picos' | 'ia'>('quedas');
  const [showAllQuedas, setShowAllQuedas] = useState(false);
  const [showAllPicos, setShowAllPicos] = useState(false);

  const quedasVisiveis = showAllQuedas ? quedas : quedas.slice(0, 8);
  const picosVisiveis = showAllPicos ? picos : picos.slice(0, 8);

  const renderQuedas = () => (
    <div>
      <h3 className="text-xs font-medium opacity-70 mb-2">🔴 QUEDAS ({quedas.length})</h3>
      <AlertasResumo resumo={resumo} tipo="QUEDA" />
      {loading ? <SkeletonCards /> : (
        <div className="space-y-3">
          {quedasVisiveis.map(a => (
            <AlertaCard key={a.sku_pai} alerta={a} onPin={onPin} isPinToggling={isPinToggling(a.sku_pai)} />
          ))}
          {quedas.length === 0 && <p className="text-xs opacity-40 text-center py-4">Nenhuma queda detectada</p>}
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
      <h3 className="text-xs font-medium opacity-70 mb-2">🟢 PICOS ({picos.length})</h3>
      <AlertasResumo resumo={resumo} tipo="PICO" />
      {loading ? <SkeletonCards /> : (
        <div className="space-y-3">
          {picosVisiveis.map(a => (
            <AlertaCard key={a.sku_pai} alerta={a} onPin={onPin} isPinToggling={isPinToggling(a.sku_pai)} />
          ))}
          {picos.length === 0 && <p className="text-xs opacity-40 text-center py-4">Nenhum pico detectado</p>}
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
          {([['quedas', `🔴 Quedas (${quedas.length})`], ['picos', `🟢 Picos (${picos.length})`], ['ia', '🤖 IA']] as const).map(([key, label]) => (
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
