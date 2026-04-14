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
  // Controla se a próxima troca mostra "refreshing" sobre dados antigos
  // (bom) ou skeleton (quando nunca tivemos dados reais).
  const hasDataRef = useRef(false);

  useEffect(() => {
    const currentFetchId = ++fetchIdRef.current;

    async function run() {
      // Se já tivemos dado bom antes, mantém visível e sinaliza refreshing.
      // Caso contrário, o initial state (loading=true, tudo null/vazio) já
      // provoca skeleton nos componentes. NÃO resetar aqui — isso causava
      // o "dashboard zerado" quando uma RPC intermitente voltava nula e o
      // mapeamento produzia {faturamento:0, ...} com loading=false no fim.
      if (hasDataRef.current) {
        setData(prev => ({ ...prev, refreshing: true }));
      }

      // Resolve o filtro de loja em um array de ecommerce_nome_tiny
      const lojas = await rpc.resolveLojaToEcommerceNomes(loja || null);
      const anterior = calcPeriodoAnterior(startStr, endStr);

      const [
        heroAtual,
        heroAnterior,
        vendasDia,
        vendasDiaAnt,
        topSkusData,
        rankingData,
        marketplaceData,
        heatmapData,
        comparativoData,
      ] = await Promise.all([
        rpc.fetchKpisHero(startStr, endStr, lojas).catch(() => null),
        rpc.fetchKpisHeroAnterior(startStr, endStr, lojas).catch(() => null),
        rpc.fetchVendasPorDia(startStr, endStr, lojas).catch(() => []),
        rpc.fetchVendasPorDia(anterior.start, anterior.end, lojas).catch(() => []),
        rpc.fetchTopSkus(startStr, endStr, lojas).catch(() => []),
        rpc.fetchRankingLojas(startStr, endStr, lojas).catch(() => []),
        rpc.fetchMarketplace(startStr, endStr, lojas).catch(() => []),
        rpc.fetchHeatmap(startStr, endStr, lojas).catch(() => []),
        rpc.fetchComparativoPeriodos(startStr, endStr, lojas).catch(() => []),
      ]);

      if (currentFetchId !== fetchIdRef.current) return;

      // Se a RPC principal falhou (retornou null) E já tínhamos dados reais,
      // preserva os dados anteriores em vez de sobrescrever com zeros.
      // Isso elimina o "flash de zeros" em falhas transientes de rede/RPC.
      const fetchFailed = heroAtual === null;
      if (fetchFailed && hasDataRef.current) {
        setData(prev => ({ ...prev, loading: false, refreshing: false }));
        console.warn('[useVendasData] fetch falhou — dados anteriores mantidos');
        return;
      }

      // ============================================================
      // MAPEAMENTOS: RPC shapes → interfaces consumidas pelos componentes
      // ============================================================

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

      const range: DateRange = { start: startStr, end: endStr };
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

      const vendasPorDia: VendaDia[] = (vendasDia ?? []).map(v => ({
        data: v.data_pedido,
        faturamento: Number(v.faturamento),
        pedidos: Number(v.pedidos),
        pecas: Number(v.pecas),
      }));

      const vendasPorDiaAnterior: VendaDia[] = (vendasDiaAnt ?? []).map(v => ({
        data: v.data_pedido,
        faturamento: Number(v.faturamento),
        pedidos: Number(v.pedidos),
        pecas: Number(v.pecas),
      }));

      const topSkus: SkuPaiAgrupado[] = (topSkusData ?? []).map(s => ({
        skuPai: s.sku_pai,
        variacoes: Array.isArray(s.variacoes) ? s.variacoes : [],
        faturamentoTotal: Number(s.faturamento),
        quantidadeTotal: Number(s.pecas),
      }));

      const rankingLojas: LojaRanking[] = (rankingData ?? []).map(r => ({
        loja: r.ecommerce_nome,
        faturamento: Number(r.faturamento),
        pecas: Number(r.pecas),
        pedidos: Number(r.pedidos),
      }));

      const marketplace: MarketplaceData[] = (marketplaceData ?? []).map(m => {
        const label = MARKETPLACE_LABEL_MAP[m.marketplace] ?? 'Outro';
        return {
          marketplace: label,
          faturamento: Number(m.faturamento),
          percentual: Number(m.percentual),
          cor: MARKETPLACE_CORES[label] ?? '#888888',
        };
      });

      const heatmap: HeatmapCell[] = (heatmapData ?? []).map(h => ({
        diaSemana: Number(h.dia_semana),
        hora: Number(h.hora),
        totalPedidos: Number(h.contagem),
      }));

      const comparativo: ComparativoPeriodo[] = (comparativoData ?? []).map(c => ({
        nome: c.nome,
        dateRange: c.date_range,
        valor: Number(c.valor),
        valorComparado: Number(c.valor_comparado),
        variacao: Number(c.variacao),
      }));

      const historico: HistoricoDia[] = (vendasDia ?? [])
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

      // Marca que temos dados reais (RPC principal respondeu).
      // Períodos legítimos sem vendas retornam heroAtual={faturamento:0,...},
      // não-null — então hasDataRef vira true e a UI mostra zeros corretamente
      // em vez de skeleton infinito.
      hasDataRef.current = !fetchFailed;

      setData({
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
      });
    }

    run();
  }, [startStr, endStr, loja, refreshKey]);

  return data;
}
