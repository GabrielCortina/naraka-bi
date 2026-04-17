'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Alerta } from '../lib/types';

export type PeriodoPreset = '30d' | '7d' | 'mes' | 'custom';
export type Marketplace = 'Mercado Livre' | 'Shopee' | 'TikTok' | 'Shein';

export interface SeriePoint {
  data: string;         // YYYY-MM-DD
  quantidade: number;
  faturamento: number;
  pedidos: number;
}

export interface LojaRow {
  loja: string;
  marketplace: Marketplace | 'Outro';
  quantidade: number;
  faturamento: number;
  variacaoPercent: number | null;
}

export interface MarketplaceSlice {
  marketplace: Marketplace | 'Outro';
  faturamento: number;
  percentual: number;
}

export interface Kpis {
  vendasMes: number;
  vendasMesAnterior: number;
  faturamentoMes: number;
  faturamentoMesAnterior: number;
  ticketMedio: number;
}

export interface Tendencia {
  dias: number;
  direcao: 'alta' | 'queda' | null;
  variacaoAcumulada: number;
}

export interface AlteracaoItem {
  id: string;
  dataAlteracao: string;
  tipoAlteracao: string;
  lojas: string[];
  valorAntes: string | null;
  valorDepois: string | null;
  motivo: string | null;
  observacao: string | null;
  impactoPercent: number | null;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function fmtDate(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function calcularDatas(
  periodo: PeriodoPreset,
  customInicio: string | null,
  customFim: string | null,
): { inicio: string; fim: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (periodo) {
    case '7d':  return { inicio: fmtDate(new Date(y, m, d - 6)),  fim: fmtDate(now) };
    case 'mes': return { inicio: fmtDate(new Date(y, m, 1)),      fim: fmtDate(now) };
    case 'custom':
      return {
        inicio: customInicio ?? fmtDate(new Date(y, m, d - 29)),
        fim:    customFim    ?? fmtDate(now),
      };
    case '30d':
    default:
      return { inicio: fmtDate(new Date(y, m, d - 29)), fim: fmtDate(now) };
  }
}

export function getMarketplace(loja: string): Marketplace | 'Outro' {
  const upper = loja.toUpperCase();
  if (upper.includes('MELI') || upper.includes('MERCADO')) return 'Mercado Livre';
  if (upper.includes('SHOPEE')) return 'Shopee';
  if (upper.includes('TIKTOK') || /\bTT\b/.test(upper)) return 'TikTok';
  if (upper.includes('SHEIN')) return 'Shein';
  return 'Outro';
}

interface RpcSerie {
  out_data: string;
  out_quantidade: number;
  out_faturamento: number;
  out_pedidos: number;
}
interface RpcLoja {
  out_loja: string;
  out_quantidade: number;
  out_faturamento: number;
  out_variacao_percent: number | null;
}
interface RpcKpis {
  out_vendas_mes: number;
  out_vendas_mes_anterior: number;
  out_faturamento_mes: number;
  out_faturamento_mes_anterior: number;
  out_ticket_medio: number;
}
interface RpcTendencia {
  out_sku_pai: string;
  out_dias_consecutivos: number;
  out_variacao_acumulada: number;
  out_direcao: string;
}
interface RpcAlteracaoSku {
  out_id: string;
  out_data_alteracao: string;
  out_tipo_alteracao: string;
  out_lojas: string[] | null;
  out_valor_antes: string | null;
  out_valor_depois: string | null;
  out_motivo: string | null;
  out_observacao: string | null;
}

async function callRpc(rpc: string, params: Record<string, unknown>) {
  try {
    const res = await fetch('/api/dashboard/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpc, params }),
    });
    const json = await res.json();
    if (!res.ok || json?.error) {
      console.error(`[useSkuModal] ${rpc} falhou:`, json?.error ?? res.statusText, params);
    }
    return json;
  } catch (err) {
    console.error(`[useSkuModal] ${rpc} exceção:`, err);
    return null;
  }
}

async function fetchAlteracoes(sku: string, dias: number): Promise<RpcAlteracaoSku[]> {
  const res = await callRpc('rpc_alteracoes_por_sku', { p_sku: sku, p_dias_atras: dias });
  return (res?.data ?? []) as RpcAlteracaoSku[];
}

async function fetchImpacto(sku: string, dataAlteracao: string): Promise<number | null> {
  const res = await callRpc('rpc_sku_modal_impacto_alteracao', {
    p_sku: sku,
    p_data_alteracao: dataAlteracao,
  });
  // A RPC retorna NUMERIC — Supabase retorna array de objeto único
  const raw = res?.data;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first == null) return null;
    if (typeof first === 'number') return first;
    if (typeof first === 'object') {
      const v = Object.values(first)[0];
      return typeof v === 'number' ? v : null;
    }
    return null;
  }
  return typeof raw === 'number' ? raw : null;
}

export function useSkuModal() {
  const [alerta, setAlerta] = useState<Alerta | null>(null);
  const isOpen = alerta !== null;

  const [periodo, setPeriodo] = useState<PeriodoPreset>('30d');
  const [customInicio, setCustomInicio] = useState<string | null>(null);
  const [customFim, setCustomFim] = useState<string | null>(null);
  const [lojasSelecionadas, setLojasSelecionadas] = useState<string[]>([]);
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);
  const [metricaChart, setMetricaChart] = useState<'quantidade' | 'faturamento'>('quantidade');

  const [serie, setSerie] = useState<SeriePoint[]>([]);
  const [porLoja, setPorLoja] = useState<LojaRow[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tendencia, setTendencia] = useState<Tendencia | null>(null);
  const [alteracoes, setAlteracoes] = useState<AlteracaoItem[]>([]);
  const [loadingSerie, setLoadingSerie] = useState(false);
  const [loadingLoja, setLoadingLoja] = useState(false);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [loadingAlteracoes, setLoadingAlteracoes] = useState(false);
  const fetchIdRef = useRef(0);

  const datas = useMemo(
    () => calcularDatas(periodo, customInicio, customFim),
    [periodo, customInicio, customFim],
  );

  // Lojas efetivas a filtrar = selecionadas ∩ (lojas do marketplace, se marketplace selecionado)
  // Se o conjunto final for vazio, passa null (= todas as lojas).
  const lojasEfetivas = useMemo<string[] | null>(() => {
    const baseMkp = marketplace
      ? lojasSelecionadas.filter(l => getMarketplace(l) === marketplace)
      : lojasSelecionadas;

    if (marketplace && lojasSelecionadas.length === 0) {
      return null;
    }
    return baseMkp.length > 0 ? baseMkp : null;
  }, [lojasSelecionadas, marketplace]);

  const openModal = useCallback((a: Alerta) => {
    setAlerta(a);
    setPeriodo('30d');
    setCustomInicio(null);
    setCustomFim(null);
    setLojasSelecionadas([]);
    setMarketplace(null);
    setMetricaChart('quantidade');
    setSerie([]);
    setPorLoja([]);
    setKpis(null);
    setTendencia(null);
    setAlteracoes([]);
  }, []);

  const closeModal = useCallback(() => setAlerta(null), []);

  // Fetch dos dados quando abrir ou mudar filtros
  useEffect(() => {
    if (!alerta) return;
    const currentId = ++fetchIdRef.current;
    const skuPai = alerta.sku_pai;

    setLoadingSerie(true);
    setLoadingLoja(true);
    setLoadingKpis(true);
    setLoadingAlteracoes(true);

    // Série temporal
    callRpc('rpc_sku_modal_serie_temporal', {
      p_sku_pai: skuPai,
      p_data_inicio: datas.inicio,
      p_data_fim: datas.fim,
      p_lojas: lojasEfetivas,
    }).then(res => {
      if (currentId !== fetchIdRef.current) return;
      const rows = (res?.data ?? []) as RpcSerie[];
      setSerie(rows.map(r => ({
        data: r.out_data,
        quantidade: Number(r.out_quantidade) || 0,
        faturamento: Number(r.out_faturamento) || 0,
        pedidos: Number(r.out_pedidos) || 0,
      })));
      setLoadingSerie(false);
    });

    // Breakdown por loja (ignora filtro de loja — sempre mostra todas para comparar)
    callRpc('rpc_sku_modal_por_loja', {
      p_sku_pai: skuPai,
      p_data_inicio: datas.inicio,
      p_data_fim: datas.fim,
    }).then(res => {
      if (currentId !== fetchIdRef.current) return;
      const rows = (res?.data ?? []) as RpcLoja[];
      setPorLoja(rows.map(r => ({
        loja: r.out_loja,
        marketplace: getMarketplace(r.out_loja),
        quantidade: Number(r.out_quantidade) || 0,
        faturamento: Number(r.out_faturamento) || 0,
        variacaoPercent: r.out_variacao_percent != null ? Number(r.out_variacao_percent) : null,
      })));
      setLoadingLoja(false);
    });

    // KPIs
    callRpc('rpc_sku_modal_kpis', {
      p_sku_pai: skuPai,
      p_lojas: lojasEfetivas,
    }).then(res => {
      if (currentId !== fetchIdRef.current) return;
      const rows = (res?.data ?? []) as RpcKpis[];
      const r = rows[0];
      if (r) {
        setKpis({
          vendasMes: Number(r.out_vendas_mes) || 0,
          vendasMesAnterior: Number(r.out_vendas_mes_anterior) || 0,
          faturamentoMes: Number(r.out_faturamento_mes) || 0,
          faturamentoMesAnterior: Number(r.out_faturamento_mes_anterior) || 0,
          ticketMedio: Number(r.out_ticket_medio) || 0,
        });
      } else {
        setKpis({ vendasMes: 0, vendasMesAnterior: 0, faturamentoMes: 0, faturamentoMesAnterior: 0, ticketMedio: 0 });
      }
      setLoadingKpis(false);
    });

    // Tendência (filtra client-side pelo sku_pai)
    callRpc('rpc_alertas_tendencia', {
      p_lojas: lojasEfetivas,
    }).then(res => {
      if (currentId !== fetchIdRef.current) return;
      const rows = (res?.data ?? []) as RpcTendencia[];
      const hit = rows.find(r => r.out_sku_pai === skuPai);
      if (hit) {
        const direcao = hit.out_direcao === 'alta' || hit.out_direcao === 'queda'
          ? hit.out_direcao as 'alta' | 'queda'
          : null;
        setTendencia({
          dias: Number(hit.out_dias_consecutivos) || 0,
          direcao,
          variacaoAcumulada: Number(hit.out_variacao_acumulada) || 0,
        });
      } else {
        setTendencia({ dias: 0, direcao: null, variacaoAcumulada: 0 });
      }
    });

    // Alterações + impacto
    (async () => {
      const diasJanela = Math.max(
        30,
        Math.ceil((new Date(datas.fim).getTime() - new Date(datas.inicio).getTime()) / 86400000) + 1,
      );
      const lista = await fetchAlteracoes(skuPai, diasJanela);
      if (currentId !== fetchIdRef.current) return;

      // Fetch impacto para cada alteração em paralelo
      const enriched: AlteracaoItem[] = await Promise.all(
        lista.map(async a => {
          const impacto = await fetchImpacto(skuPai, a.out_data_alteracao);
          return {
            id: a.out_id,
            dataAlteracao: a.out_data_alteracao,
            tipoAlteracao: a.out_tipo_alteracao,
            lojas: a.out_lojas ?? [],
            valorAntes: a.out_valor_antes,
            valorDepois: a.out_valor_depois,
            motivo: a.out_motivo,
            observacao: a.out_observacao,
            impactoPercent: impacto,
          };
        }),
      );
      if (currentId !== fetchIdRef.current) return;
      setAlteracoes(enriched);
      setLoadingAlteracoes(false);
    })();
  }, [alerta, datas, lojasEfetivas]);

  // Pizza derivada do porLoja
  const porMarketplace = useMemo<MarketplaceSlice[]>(() => {
    const acc = new Map<string, number>();
    let total = 0;
    for (const l of porLoja) {
      const key = l.marketplace;
      acc.set(key, (acc.get(key) ?? 0) + l.faturamento);
      total += l.faturamento;
    }
    if (total === 0) return [];
    return Array.from(acc.entries())
      .map(([mkp, fat]) => ({
        marketplace: mkp as MarketplaceSlice['marketplace'],
        faturamento: fat,
        percentual: Math.round((fat / total) * 1000) / 10,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }, [porLoja]);

  const loading = loadingSerie || loadingLoja || loadingKpis || loadingAlteracoes;

  return {
    // Estado
    alerta,
    isOpen,
    // Filtros
    periodo, setPeriodo,
    customInicio, setCustomInicio,
    customFim, setCustomFim,
    lojasSelecionadas, setLojasSelecionadas,
    marketplace, setMarketplace,
    metricaChart, setMetricaChart,
    datas,
    // Dados
    serie,
    porLoja,
    porMarketplace,
    kpis,
    tendencia,
    alteracoes,
    // Loading
    loading,
    loadingSerie,
    loadingLoja,
    loadingKpis,
    loadingAlteracoes,
    // Ações
    openModal,
    closeModal,
  };
}
