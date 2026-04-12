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

    // Cada query independente — se uma falha, as outras continuam
    async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        console.error(`[dashboard] Erro em ${label}:`, err);
        return fallback;
      }
    }

    const emptyHero: ResumoHero = {
      faturamento: 0, pedidos: 0, ticketMedio: 0, pecasVendidas: 0,
      faturamentoAnterior: 0, pedidosAnterior: 0, ticketMedioAnterior: 0, pecasAnterior: 0,
    };
    const emptyKpis: KpisSecundarios = {
      mediaDiariaRs: 0, melhorDia: { data: '', valor: 0 }, projecaoMesRs: null,
      mediaDiariaPecas: 0, projecaoMesPecas: null, cancelamentos: 0, valorCancelado: 0,
    };

    const [
      resumoHero, kpisSecundarios, vendasPorDia, vendasPorDiaAnterior,
      topSkus, rankingLojas, marketplace, heatmap, comparativo, historico,
    ] = await Promise.all([
      safe(() => queries.getResumoHero(start, end, lojaParam), emptyHero, 'resumoHero'),
      safe(() => queries.getKpisSecundarios(start, end, lojaParam), emptyKpis, 'kpisSecundarios'),
      safe(() => queries.getVendasPorDia(start, end, lojaParam), [], 'vendasPorDia'),
      safe(() => queries.getVendasPorDia(antStart, antEnd, lojaParam), [], 'vendasPorDiaAnterior'),
      safe(() => queries.getTopSkus(start, end, lojaParam), [], 'topSkus'),
      safe(() => queries.getRankingLojas(start, end, lojaParam), [], 'rankingLojas'),
      safe(() => queries.getVendasPorMarketplace(start, end, lojaParam), [], 'marketplace'),
      safe(() => queries.getHeatmapHorarios(start, end, lojaParam), [], 'heatmap'),
      safe(() => queries.getComparativoPeriodos(), [], 'comparativo'),
      safe(() => queries.getHistoricoDias(start, end, lojaParam), [], 'historico'),
    ]);

    setData({
      resumoHero, kpisSecundarios, vendasPorDia, vendasPorDiaAnterior,
      topSkus, rankingLojas, marketplace, heatmap, comparativo, historico,
      loading: false,
    });
  }, [dateRange, loja]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return data;
}
