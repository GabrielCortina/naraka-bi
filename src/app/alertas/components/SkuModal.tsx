'use client';

import { useEffect, useMemo } from 'react';
import type { useSkuModal as useSkuModalType, Marketplace, LojaConfigEntry } from '../hooks/useSkuModal';
import { normalizeMarketplace } from '../hooks/useSkuModal';
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
  lojaConfig: LojaConfigEntry[];
}

function ErrorBanner({ errors }: { errors: ModalState['errors'] }) {
  const hasError = Object.values(errors).some(Boolean);
  if (!hasError) return null;
  return (
    <div className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
      <div className="font-medium mb-1">Algumas seções falharam ao carregar:</div>
      <ul className="list-disc pl-4 space-y-0.5">
        {errors.serie && <li><b>Série temporal:</b> {errors.serie}</li>}
        {errors.loja && <li><b>Por loja:</b> {errors.loja}</li>}
        {errors.kpis && <li><b>KPIs:</b> {errors.kpis}</li>}
        {errors.alteracoes && <li><b>Alterações:</b> {errors.alteracoes}</li>}
      </ul>
    </div>
  );
}

export function SkuModal({ state, lojaConfig }: Props) {
  const {
    alerta, isOpen,
    periodo, setPeriodo,
    customInicio, setCustomInicio,
    customFim, setCustomFim,
    lojasSelecionadas, setLojasSelecionadas,
    marketplace, setMarketplace,
    metricaChart, setMetricaChart,
    datas,
    lojasDisponiveis,
    serie, porLoja, porMarketplace, kpis, headerDeltas, tendencia, alteracoes,
    errors,
    loadingSerie, loadingLoja, loadingKpis, loadingAlteracoes,
    closeModal,
  } = state;

  // Mapa nome_loja → marketplace para o dropdown do filtro
  const lojaToMarketplace = useMemo<Record<string, Marketplace | 'Outro'>>(() => {
    const m: Record<string, Marketplace | 'Outro'> = {};
    for (const c of lojaConfig) {
      const key = c.nome_loja || c.nome_exibicao;
      // Não sobrescreve se já houver um mapeamento específico
      if (!m[key] || m[key] === 'Outro') {
        m[key] = normalizeMarketplace(c.marketplace);
      }
    }
    return m;
  }, [lojaConfig]);

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

  const periodoLabel = `${datas.inicio} → ${datas.fim}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-modal-title"
      className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm"
      onClick={closeModal}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-5xl max-h-full md:max-h-[90vh] flex flex-col rounded-none md:rounded-xl shadow-xl dark:bg-[#0f1117] bg-white border border-current/10 overflow-hidden"
      >
        <div id="sku-modal-title" className="sr-only">Detalhes do SKU {alerta.sku_pai}</div>

        <div className="shrink-0">
          <SkuModalHeader alerta={alerta} deltas={headerDeltas} onClose={closeModal} />
        </div>

        <div className="p-5 overflow-y-auto flex-1">
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
            lojaToMarketplace={lojaToMarketplace}
          />

          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-3 -mt-2">
            Período: {periodoLabel}
          </p>

          <ErrorBanner errors={errors} />

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
