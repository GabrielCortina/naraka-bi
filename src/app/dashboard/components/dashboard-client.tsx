'use client';

import { useState } from 'react';
import { usePeriodFilter } from '../hooks/use-period-filter';
import { useTheme } from '../hooks/use-theme';
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
import { hoje } from '../lib/date-utils';

export function DashboardClient() {
  const { theme, toggleTheme } = useTheme();
  const { filter, setFilter, dateRange, loja, setLoja, setCustomRange } = usePeriodFilter();
  const data = useVendasData(dateRange, loja);

  const [customStart, setCustomStart] = useState(hoje());
  const [customEnd, setCustomEnd] = useState(hoje());

  function handleCustomStartChange(v: string) {
    setCustomStart(v);
    setCustomRange({ start: v, end: customEnd });
  }

  function handleCustomEndChange(v: string) {
    setCustomEnd(v);
    setCustomRange({ start: customStart, end: v });
  }

  // Tema via classes CSS
  const themeClass = theme === 'dark' ? 'theme-dark' : 'theme-light';

  return (
    <div className={`${themeClass} min-h-screen transition-colors duration-200`}
      style={{
        backgroundColor: theme === 'dark' ? '#0f1117' : '#f8f9fa',
        color: theme === 'dark' ? '#ffffff' : '#111827',
      }}
    >
      <style>{`
        .${themeClass} .card {
          background: ${theme === 'dark' ? '#1a1d27' : '#ffffff'};
          border: 1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'};
        }
        .${themeClass} .card-secondary {
          background: ${theme === 'dark' ? '#222536' : '#f1f3f5'};
          border: 1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'};
        }
        .${themeClass} select option {
          background: ${theme === 'dark' ? '#1a1d27' : '#ffffff'};
          color: ${theme === 'dark' ? '#ffffff' : '#111827'};
        }
      `}</style>

      <div className="max-w-[1400px] mx-auto p-4 md:p-6">
        {/* Header */}
        <DashboardHeader
          filter={filter}
          onFilterChange={setFilter}
          loja={loja}
          onLojaChange={setLoja}
          theme={theme}
          onToggleTheme={toggleTheme}
          customStart={customStart}
          customEnd={customEnd}
          onCustomStartChange={handleCustomStartChange}
          onCustomEndChange={handleCustomEndChange}
        />

        {/* KPIs Hero */}
        <KpisHero data={data.resumoHero} loading={data.loading} />

        {/* KPIs Secundários */}
        <KpisSecundarios data={data.kpisSecundarios} loading={data.loading} />

        {/* Gráfico + Comparativo */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <GraficoVendas atual={data.vendasPorDia} anterior={data.vendasPorDiaAnterior} loading={data.loading} />
          <ComparativoPeriodos data={data.comparativo} loading={data.loading} />
        </div>

        {/* Top SKUs + Ranking/Marketplace + Heatmap */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <TopSkus
            data={data.topSkus}
            loading={data.loading}
            startDate={dateRange.start}
            endDate={dateRange.end}
            loja={loja || undefined}
          />
          <div className="space-y-4">
            <RankingLojas data={data.rankingLojas} loading={data.loading} />
            <MarketplaceChart data={data.marketplace} loading={data.loading} />
          </div>
          <HeatmapHorarios data={data.heatmap} loading={data.loading} />
        </div>

        {/* Histórico por dia */}
        <HistoricoDias data={data.historico} loading={data.loading} />
      </div>
    </div>
  );
}
