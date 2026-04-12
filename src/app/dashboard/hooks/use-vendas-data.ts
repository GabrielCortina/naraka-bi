'use client';

import { useState, useEffect, useCallback } from 'react';
import type {
  DateRange, ResumoHero, KpisSecundarios, VendaDia,
  SkuPaiAgrupado, LojaRanking, MarketplaceData, HeatmapCell,
  ComparativoPeriodo, HistoricoDia,
} from '../types';
import * as queries from '../lib/vendas-queries';

interface VendasData {
  resumoHero: ResumoHero | null;
  kpisSecundarios: KpisSecundarios | null;
  vendasPorDia: VendaDia[];
  vendasPorDiaAnterior: VendaDia[];
  topSkus: SkuPaiAgrupado[];
  rankingLojas: LojaRanking[];
  marketplace: MarketplaceData[];
  heatmap: HeatmapCell[];
  comparativo: ComparativoPeriodo[];
  historico: HistoricoDia[];
  loading: boolean;
}

export function useVendasData(dateRange: DateRange, loja: string) {
  const [data, setData] = useState<VendasData>({
    resumoHero: null,
    kpisSecundarios: null,
    vendasPorDia: [],
    vendasPorDiaAnterior: [],
    topSkus: [],
    rankingLojas: [],
    marketplace: [],
    heatmap: [],
    comparativo: [],
    historico: [],
    loading: true,
  });

  const fetchAll = useCallback(async () => {
    setData(prev => ({ ...prev, loading: true }));

    const lojaParam = loja || undefined;
    const { start, end } = dateRange;

    // Período anterior para gráfico comparativo
    const anteriorEnd = new Date(new Date(start).getTime() - 86400000);
    const dias = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
    const anteriorStart = new Date(anteriorEnd.getTime() - (dias - 1) * 86400000);
    const antStart = anteriorStart.toISOString().split('T')[0];
    const antEnd = anteriorEnd.toISOString().split('T')[0];

    try {
      const [
        resumoHero, kpisSecundarios, vendasPorDia, vendasPorDiaAnterior,
        topSkus, rankingLojas, marketplace, heatmap, comparativo, historico,
      ] = await Promise.all([
        queries.getResumoHero(start, end, lojaParam),
        queries.getKpisSecundarios(start, end, lojaParam),
        queries.getVendasPorDia(start, end, lojaParam),
        queries.getVendasPorDia(antStart, antEnd, lojaParam),
        queries.getTopSkus(start, end, lojaParam),
        queries.getRankingLojas(start, end, lojaParam),
        queries.getVendasPorMarketplace(start, end, lojaParam),
        queries.getHeatmapHorarios(start, end, lojaParam),
        queries.getComparativoPeriodos(),
        queries.getHistoricoDias(start, end, lojaParam),
      ]);

      setData({
        resumoHero, kpisSecundarios, vendasPorDia, vendasPorDiaAnterior,
        topSkus, rankingLojas, marketplace, heatmap, comparativo, historico,
        loading: false,
      });
    } catch (err) {
      console.error('[dashboard] Erro ao buscar dados:', err);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [dateRange, loja]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return data;
}
