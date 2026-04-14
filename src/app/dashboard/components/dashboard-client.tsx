'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import { usePeriodFilter } from '../hooks/use-period-filter';
import { useVendasData } from '../hooks/use-vendas-data';
import { DashboardHeader } from './dashboard-header';
import { KpisHero } from './kpis-hero';
import { KpisSecundarios } from './kpis-secundarios';
import { GraficoVendas } from './grafico-vendas';
import { ComparativoPeriodos } from './comparativo-periodos';
import { TopSkus } from './top-skus';
import { RankingLojas } from './ranking-lojas';
import { MarketplaceChart } from './marketplace-chart';
import { HeatmapHorarios } from './heatmap-horarios';
import { HistoricoDias } from './historico-dias';
import { LojaConfigModal } from './loja-config-modal';
import { hoje } from '../lib/date-utils';

const AUTO_REFRESH_MS = 5 * 60 * 1000; // 5 minutos

interface LojaOption {
  nome_exibicao: string;
}

export function DashboardClient() {
  const { filter, setFilter, dateRange, loja, setLoja, setCustomRange } = usePeriodFilter();

  const [customStart, setCustomStart] = useState(hoje());
  const [customEnd, setCustomEnd] = useState(hoje());
  const [configOpen, setConfigOpen] = useState(false);
  const [lojas, setLojas] = useState<LojaOption[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const data = useVendasData(dateRange, loja, refreshKey);

  // Auto-refresh a cada 5 minutos.
  // - Pula o refresh quando a aba está oculta (custo desnecessário).
  // - Ao voltar a ficar visível depois de >AUTO_REFRESH_MS oculta,
  //   dispara refresh imediato (dados podem estar bem desatualizados).
  useEffect(() => {
    let hiddenAt: number | null = null;

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        setRefreshKey(k => k + 1);
      }
    }, AUTO_REFRESH_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null) {
        const wasHiddenMs = Date.now() - hiddenAt;
        hiddenAt = null;
        if (wasHiddenMs > AUTO_REFRESH_MS) {
          setRefreshKey(k => k + 1);
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Escuta evento da sidebar para abrir config de lojas
  useEffect(() => {
    const handler = () => setConfigOpen(true);
    window.addEventListener('naraka:open-loja-config', handler);
    return () => window.removeEventListener('naraka:open-loja-config', handler);
  }, []);

  const loadLojas = useCallback(async () => {
    const db = createBrowserClient();
    const { data: configs } = await db.from('loja_config')
      .select('nome_exibicao, nome_loja')
      .eq('ativo', true)
      .order('nome_exibicao');

    if (configs && configs.length > 0) {
      const nomes = configs.map(c => c.nome_loja || c.nome_exibicao);
      const unicos = Array.from(new Set(nomes)).sort();
      setLojas(unicos.map(nome => ({ nome_exibicao: nome })));
    } else {
      const nomesSet = new Set<string>();
      let offset = 0;
      while (true) {
        const { data: page } = await db.from('pedidos')
          .select('ecommerce_nome')
          .not('ecommerce_nome', 'is', null)
          .range(offset, offset + 999);
        if (!page || page.length === 0) break;
        for (const p of page) { if (p.ecommerce_nome) nomesSet.add(p.ecommerce_nome); }
        if (page.length < 1000) break;
        offset += 1000;
      }
      const nomes = Array.from(nomesSet).sort();
      setLojas(nomes.map(nome => ({ nome_exibicao: nome })));
    }
  }, []);

  useEffect(() => {
    loadLojas();
  }, [loadLojas, refreshKey]);

  function handleCustomStartChange(v: string) {
    setCustomStart(v);
    setCustomRange({ start: v, end: customEnd });
  }

  function handleCustomEndChange(v: string) {
    setCustomEnd(v);
    setCustomRange({ start: customStart, end: v });
  }

  function handleConfigSaved() {
    setRefreshKey(k => k + 1);
    setConfigOpen(false);
  }

  return (
    <>
      <div className="max-w-[1400px] mx-auto p-4 md:p-6">
        <DashboardHeader
          filter={filter}
          onFilterChange={setFilter}
          loja={loja}
          onLojaChange={setLoja}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={handleCustomStartChange}
          onCustomEndChange={handleCustomEndChange}
          lojas={lojas}
          onOpenConfig={() => setConfigOpen(true)}
          refreshing={data.refreshing}
          lastUpdated={data.lastUpdated}
        />

        <KpisHero data={data.resumoHero} loading={data.loading} />
        <KpisSecundarios data={data.kpisSecundarios} loading={data.loading} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <GraficoVendas atual={data.vendasPorDia} anterior={data.vendasPorDiaAnterior} loading={data.loading} />
          <ComparativoPeriodos data={data.comparativo} loading={data.loading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <TopSkus
            data={data.topSkus}
            loading={data.loading}
            startDate={dateRange.start}
            endDate={dateRange.end}
            loja={loja || undefined}
          />
          <div className="space-y-4">
            <RankingLojas data={data.rankingLojas} loading={data.loading} refreshKey={refreshKey} />
            <MarketplaceChart data={data.marketplace} loading={data.loading} />
          </div>
          <HeatmapHorarios data={data.heatmap} loading={data.loading} />
        </div>

        <HistoricoDias data={data.historico} loading={data.loading} />
      </div>

      <LojaConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={handleConfigSaved}
      />
    </>
  );
}
