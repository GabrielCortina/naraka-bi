'use client';

import { useState, useEffect, useRef } from 'react';
import type {
  DateRange, ResumoHero, KpisSecundarios, VendaDia,
  SkuPaiAgrupado, LojaRanking, MarketplaceData, HeatmapCell,
  ComparativoPeriodo, HistoricoDia,
} from '../types';
import { MARKETPLACE_CORES } from '../types';
import * as rpc from '../lib/rpc-queries';
import { diasNoRange, diasRestantesMes, periodoIncluiMesAtual } from '../lib/date-utils';

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
  refreshing: boolean;
  lastUpdated: Date | null;
}

const MARKETPLACE_LABEL_MAP: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  tiktok: 'TikTok Shop',
  shein: 'Shein',
};

function formatYmdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function calcPeriodoAnterior(start: string, end: string): { start: string; end: string } {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const dias = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  const antEnd = new Date(s.getTime() - 86400000);
  const antStart = new Date(antEnd.getTime() - (dias - 1) * 86400000);
  return { start: formatYmdLocal(antStart), end: formatYmdLocal(antEnd) };
}

// TTL variável (S9): períodos históricos imutáveis ficam 30min em cache;
// período atual (inclui hoje) só 60s — pode receber novos pedidos.
function getCacheTTL(_startStr: string, endStr: string): number {
  const todayStr = formatYmdLocal(new Date());
  const isCurrentPeriod = endStr >= todayStr;
  return isCurrentPeriod ? 60_000 : 30 * 60_000;
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
  // hasDataRef = true só depois de um fetch bem-sucedido.
  const hasDataRef = useRef(false);

  // Cache por filterKey. Troca de filtro com cache fresco (≤TTL) é
  // instantânea. Auto-refresh (refreshKey++) limpa o cache e refaz fetch.
  const cacheRef = useRef<Map<string, { data: VendasData; ts: number }>>(new Map());
  const lastRefreshKeyRef = useRef(refreshKey);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;
    const filterKey = `${startStr}|${endStr}|${loja}`;
    const lojaParam = loja || null;

    // refreshKey++ (auto-refresh ou config saved) → invalida todo o cache.
    const isRefreshKeyChange = lastRefreshKeyRef.current !== refreshKey;
    lastRefreshKeyRef.current = refreshKey;
    if (isRefreshKeyChange) {
      cacheRef.current.clear();
    }

    // Cache hit em troca de filtro: render instantâneo, sem fetch.
    // TTL depende do período (60s atual / 30min histórico).
    if (!isRefreshKeyChange) {
      const cached = cacheRef.current.get(filterKey);
      if (cached && Date.now() - cached.ts < getCacheTTL(startStr, endStr)) {
        hasDataRef.current = true;
        setData({
          ...cached.data,
          loading: false,
          refreshing: false,
          lastUpdated: new Date(cached.ts),
        });
        return;
      }
    }

    async function run() {
      // Se já tivemos dado bom antes, mantém visível e sinaliza refreshing.
      // Caso contrário, o initial state (loading=true) provoca skeleton.
      if (hasDataRef.current) {
        setData(prev => ({ ...prev, refreshing: true }));
      }

      const anterior = calcPeriodoAnterior(startStr, endStr);
      const range: DateRange = { start: startStr, end: endStr };

      // ============================================================
      // GROUP 1 — HERO (crítico, rápido)
      // Aparece em <500ms. Hero v2 retorna atual + anterior em 1 chamada.
      // ============================================================
      const heroPair = await rpc
        .fetchKpisHeroV2(startStr, endStr, lojaParam)
        .catch(() => ({ atual: null, anterior: null }));

      if (currentFetchId !== fetchIdRef.current) return;

      const heroAtual = heroPair.atual;
      const heroAnterior = heroPair.anterior;
      const fetchFailed = heroAtual === null;

      // Se Hero falhou e já tínhamos dados, preserva (evita flash de zeros).
      if (fetchFailed && hasDataRef.current) {
        setData(prev => ({ ...prev, loading: false, refreshing: false }));
        console.warn('[useVendasData] hero v2 falhou — dados anteriores mantidos');
        return;
      }

      const resumoHero: ResumoHero = {
        faturamento: Number(heroAtual?.faturamento ?? 0),
        pedidos: Number(heroAtual?.pedidos ?? 0),
        ticketMedio: Number(heroAtual?.ticket ?? 0),
        pecasVendidas: Number(heroAtual?.pecas ?? 0),
        faturamentoAnterior: Number(heroAnterior?.faturamento ?? 0),
        pedidosAnterior: Number(heroAnterior?.pedidos ?? 0),
        ticketMedioAnterior: Number(heroAnterior?.ticket ?? 0),
        pecasAnterior: Number(heroAnterior?.pecas ?? 0),
      };

      const dias = diasNoRange(range);
      const fatTotal = Number(heroAtual?.faturamento ?? 0);
      const pecasTotal = Number(heroAtual?.pecas ?? 0);
      const mediaDiariaRs = dias > 0 ? fatTotal / dias : 0;
      const mediaDiariaPecas = dias > 0 ? pecasTotal / dias : 0;

      let projecaoMesRs: number | null = null;
      let projecaoMesPecas: number | null = null;
      if (periodoIncluiMesAtual(range)) {
        const restantes = diasRestantesMes();
        projecaoMesRs = fatTotal + mediaDiariaRs * restantes;
        projecaoMesPecas = pecasTotal + mediaDiariaPecas * restantes;
      }

      const kpisSecundarios: KpisSecundarios = {
        mediaDiariaRs,
        melhorDia: {
          data: heroAtual?.melhor_dia ?? '',
          valor: Number(heroAtual?.melhor_dia_valor ?? 0),
        },
        projecaoMesRs,
        mediaDiariaPecas,
        projecaoMesPecas,
        cancelamentos: Number(heroAtual?.cancelamentos ?? 0),
        valorCancelado: Number(heroAtual?.valor_cancelado ?? 0),
      };

      // Atualização parcial: Hero/secundários já visíveis, resto skeleton.
      // loading=false → componentes do Hero saem do skeleton.
      // refreshing=true → header mostra "Atualizando..." enquanto Group 2 carrega.
      setData(prev => ({
        ...prev,
        resumoHero,
        kpisSecundarios,
        loading: false,
        refreshing: true,
      }));

      // ============================================================
      // GROUP 2 — SECUNDÁRIO (gráficos, tabelas, heatmap)
      // 1 invocação Vercel via /api/dashboard/batch.
      // ============================================================
      const secundario = await rpc
        .fetchDashboardSecundario(startStr, endStr, anterior.start, anterior.end, lojaParam)
        .catch(() => null);

      if (currentFetchId !== fetchIdRef.current) return;

      if (!secundario) {
        // Group 2 falhou — Hero permanece, restante fica vazio mas sem zeros.
        setData(prev => ({ ...prev, refreshing: false }));
        return;
      }

      const vendasPorDia: VendaDia[] = secundario.vendasPorDia.map(v => ({
        data: v.data_pedido,
        faturamento: Number(v.faturamento),
        pedidos: Number(v.pedidos),
        pecas: Number(v.pecas),
      }));

      const vendasPorDiaAnterior: VendaDia[] = secundario.vendasPorDiaAnterior.map(v => ({
        data: v.data_pedido,
        faturamento: Number(v.faturamento),
        pedidos: Number(v.pedidos),
        pecas: Number(v.pecas),
      }));

      const topSkus: SkuPaiAgrupado[] = secundario.topSkus.map(s => ({
        skuPai: s.sku_pai,
        variacoes: Array.isArray(s.variacoes) ? s.variacoes : [],
        faturamentoTotal: Number(s.faturamento),
        quantidadeTotal: Number(s.pecas),
      }));

      const rankingLojas: LojaRanking[] = secundario.rankingLojas.map(r => ({
        loja: r.ecommerce_nome,
        faturamento: Number(r.faturamento),
        pecas: Number(r.pecas),
        pedidos: Number(r.pedidos),
      }));

      const marketplace: MarketplaceData[] = secundario.marketplace.map(m => {
        const label = MARKETPLACE_LABEL_MAP[m.marketplace] ?? 'Outro';
        return {
          marketplace: label,
          faturamento: Number(m.faturamento),
          percentual: Number(m.percentual),
          cor: MARKETPLACE_CORES[label] ?? '#888888',
        };
      });

      const heatmap: HeatmapCell[] = secundario.heatmap.map(h => ({
        diaSemana: Number(h.dia_semana),
        hora: Number(h.hora),
        totalPedidos: Number(h.contagem),
      }));

      const comparativo: ComparativoPeriodo[] = secundario.comparativo.map(c => ({
        nome: c.nome,
        dateRange: c.date_range,
        valor: Number(c.valor),
        valorComparado: Number(c.valor_comparado),
        variacao: Number(c.variacao),
      }));

      const historico: HistoricoDia[] = secundario.vendasPorDia
        .map(v => ({
          data: v.data_pedido,
          faturamento: Number(v.faturamento),
          pedidos: Number(v.pedidos),
          pecas: Number(v.pecas),
          ticketMedio: Number(v.ticket_medio),
          cancelamentos: Number(v.cancelamentos),
          fatCancelado: Number(v.fat_cancelado),
        }))
        .sort((a, b) => b.data.localeCompare(a.data));

      hasDataRef.current = true;

      const newData: VendasData = {
        resumoHero,
        kpisSecundarios,
        vendasPorDia,
        vendasPorDiaAnterior,
        topSkus,
        rankingLojas,
        marketplace,
        heatmap,
        comparativo,
        historico,
        loading: false,
        refreshing: false,
        lastUpdated: new Date(),
      };

      cacheRef.current.set(filterKey, { data: newData, ts: Date.now() });
      setData(newData);
    }

    run();
  }, [startStr, endStr, loja, refreshKey]);

  return data;
}
