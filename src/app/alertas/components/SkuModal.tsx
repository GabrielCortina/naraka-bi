'use client';

import { useEffect } from 'react';
import type { useSkuModal as useSkuModalType } from '../hooks/useSkuModal';
import { SkuModalHeader } from './SkuModalHeader';
import { SkuModalFilters } from './SkuModalFilters';
import { SkuModalKPIs } from './SkuModalKPIs';
import { SkuModalChart } from './SkuModalChart';
import { SkuModalPieMarketplace } from './SkuModalPieMarketplace';
import { SkuModalLojaRanking } from './SkuModalLojaRanking';
import { SkuModalAlteracoes } from './SkuModalAlteracoes';

type ModalState = ReturnType<typeof useSkuModalType>;

interface Props {
  state: ModalState;
  lojasDisponiveis: string[];
}

export function SkuModal({ state, lojasDisponiveis }: Props) {
  const {
    alerta, isOpen,
    periodo, setPeriodo,
    customInicio, setCustomInicio,
    customFim, setCustomFim,
    lojasSelecionadas, setLojasSelecionadas,
    marketplace, setMarketplace,
    metricaChart, setMetricaChart,
    serie, porLoja, porMarketplace, kpis, tendencia, alteracoes,
    loadingSerie, loadingLoja, loadingKpis, loadingAlteracoes,
    closeModal,
  } = state;

  // ESC para fechar + bloquear scroll do body
  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [isOpen, closeModal]);

  if (!isOpen || !alerta) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-modal-title"
      className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/60 backdrop-blur-sm overflow-y-auto"
      onClick={closeModal}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-5xl md:my-6 rounded-none md:rounded-xl shadow-xl dark:bg-[#0f1117] bg-white border border-current/10"
      >
        <div id="sku-modal-title" className="sr-only">Detalhes do SKU {alerta.sku_pai}</div>

        <SkuModalHeader alerta={alerta} onClose={closeModal} />

        <div className="p-5">
          <SkuModalFilters
            periodo={periodo}
            onPeriodoChange={setPeriodo}
            customInicio={customInicio}
            customFim={customFim}
            onCustomInicioChange={setCustomInicio}
            onCustomFimChange={setCustomFim}
            lojasSelecionadas={lojasSelecionadas}
            onLojasChange={setLojasSelecionadas}
            marketplace={marketplace}
            onMarketplaceChange={setMarketplace}
            lojasDisponiveis={lojasDisponiveis}
          />

          <SkuModalKPIs kpis={kpis} tendencia={tendencia} loading={loadingKpis} />

          <SkuModalChart
            serie={serie}
            alteracoes={alteracoes}
            metrica={metricaChart}
            onMetricaChange={setMetricaChart}
            loading={loadingSerie}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <SkuModalPieMarketplace dados={porMarketplace} loading={loadingLoja} />
            <SkuModalLojaRanking dados={porLoja} loading={loadingLoja} />
          </div>

          <SkuModalAlteracoes alteracoes={alteracoes} loading={loadingAlteracoes} />
        </div>
      </div>
    </div>
  );
}
