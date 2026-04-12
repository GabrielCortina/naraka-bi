'use client';

import { useState, useEffect, useRef } from 'react';
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
  loading: boolean;      // true apenas no primeiro carregamento
  refreshing: boolean;   // true durante auto-refresh em background
  lastUpdated: Date | null;
}

const TIMEOUT_MS = 10000;

function withTimeout<T>(fn: () => Promise<T>, fallback: T, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export function useVendasData(dateRange: DateRange, loja: string, refreshKey: number = 0) {
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
    refreshing: false,
    lastUpdated: null,
  });

  const startStr = dateRange.start;
  const endStr = dateRange.end;
  const fetchIdRef = useRef(0);
  const hasDataRef = useRef(false);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;
    const isBackgroundRefresh = hasDataRef.current;

    async function fetchAll() {
      // Primeiro load: loading=true. Auto-refresh: refreshing=true sem skeleton
      if (isBackgroundRefresh) {
        setData(prev => ({ ...prev, refreshing: true }));
      } else {
        setData(prev => ({ ...prev, loading: true }));
      }

      const lojaParam = loja || undefined;

      const anteriorEnd = new Date(new Date(startStr).getTime() - 86400000);
      const dias = Math.round((new Date(endStr).getTime() - new Date(startStr).getTime()) / 86400000) + 1;
      const anteriorStart = new Date(anteriorEnd.getTime() - (dias - 1) * 86400000);
      const antStart = anteriorStart.toISOString().split('T')[0];
      const antEnd = anteriorEnd.toISOString().split('T')[0];

      async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
        try {
          return await withTimeout(fn, fallback, TIMEOUT_MS);
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
        safe(() => queries.getResumoHero(startStr, endStr, lojaParam), emptyHero, 'resumoHero'),
        safe(() => queries.getKpisSecundarios(startStr, endStr, lojaParam), emptyKpis, 'kpisSecundarios'),
        safe(() => queries.getVendasPorDia(startStr, endStr, lojaParam), [], 'vendasPorDia'),
        safe(() => queries.getVendasPorDia(antStart, antEnd, lojaParam), [], 'vendasPorDiaAnterior'),
        safe(() => queries.getTopSkus(startStr, endStr, lojaParam), [], 'topSkus'),
        safe(() => queries.getRankingLojas(startStr, endStr, lojaParam), [], 'rankingLojas'),
        safe(() => queries.getVendasPorMarketplace(startStr, endStr, lojaParam), [], 'marketplace'),
        safe(() => queries.getHeatmapHorarios(startStr, endStr, lojaParam), [], 'heatmap'),
        safe(() => queries.getComparativoPeriodos(), [], 'comparativo'),
        safe(() => queries.getHistoricoDias(startStr, endStr, lojaParam), [], 'historico'),
      ]);

      if (currentFetchId !== fetchIdRef.current) return;

      hasDataRef.current = true;
      setData({
        resumoHero, kpisSecundarios, vendasPorDia, vendasPorDiaAnterior,
        topSkus, rankingLojas, marketplace, heatmap, comparativo, historico,
        loading: false,
        refreshing: false,
        lastUpdated: new Date(),
      });
    }

    fetchAll();
  }, [startStr, endStr, loja, refreshKey]);

  return data;
}
