'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Alerta } from '../lib/types';

export type PeriodoPreset = 'hoje' | 'ontem' | '7d' | '15d' | '30d' | 'mes' | 'custom';
export type Marketplace = 'Mercado Livre' | 'Shopee' | 'TikTok' | 'Shein';

export interface LojaConfigEntry {
  ecommerce_nome_tiny: string;
  nome_exibicao: string;
  nome_loja: string | null;
  marketplace: string | null;
}

export interface SeriePoint {
  data: string;
  quantidade: number;
  faturamento: number;
  pedidos: number;
}

export interface LojaRow {
  loja: string;                            // nome_loja (display)
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
  vendas: number;
  vendasAnterior: number;
  faturamento: number;
  faturamentoAnterior: number;
  ticketMedio: number;
}

export interface HeaderDeltas {
  deltaPecas: number;
  deltaFaturamento: number;
  variacaoPct: number | null;
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

export type FetchErrorMap = Partial<Record<'serie' | 'loja' | 'kpis' | 'alteracoes', string>>;

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
    case 'hoje': {
      const hoje = fmtDate(now);
      return { inicio: hoje, fim: hoje };
    }
    case 'ontem': {
      const ontem = fmtDate(new Date(y, m, d - 1));
      return { inicio: ontem, fim: ontem };
    }
    case '7d':  return { inicio: fmtDate(new Date(y, m, d - 6)),  fim: fmtDate(now) };
    case '15d': return { inicio: fmtDate(new Date(y, m, d - 14)), fim: fmtDate(now) };
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

// Normaliza valores da coluna loja_config.marketplace (mercado_livre, shopee, tiktok, shein)
// para os rótulos canônicos usados na UI.
export function normalizeMarketplace(raw: string | null | undefined): Marketplace | 'Outro' {
  if (!raw) return 'Outro';
  const v = raw.toLowerCase().replace(/[_\s-]+/g, '');
  if (v === 'mercadolivre' || v === 'meli' || v === 'ml') return 'Mercado Livre';
  if (v === 'shopee') return 'Shopee';
  if (v === 'tiktok' || v === 'tiktokshop') return 'TikTok';
  if (v === 'shein') return 'Shein';
  return 'Outro';
}

interface RpcSerie {
  out_data: string;
  out_quantidade: number | string;
  out_faturamento: number | string;
  out_pedidos: number | string;
}
interface RpcSerieHoje {
  out_hora: number;
  out_quantidade: number | string;
  out_faturamento: number | string;
  out_pedidos: number | string;
}
interface RpcKpisHoje extends RpcKpis {
  out_hora_corte?: number;
}
interface RpcLoja {
  out_loja: string;
  out_quantidade: number | string;
  out_faturamento: number | string;
  out_variacao_percent: number | string | null;
}
interface RpcKpis {
  out_vendas: number | string;
  out_vendas_anterior: number | string;
  out_faturamento: number | string;
  out_faturamento_anterior: number | string;
  out_ticket_medio: number | string;
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

interface RpcResponse {
  data?: unknown[];
  error?: string;
}

async function callRpc(rpc: string, params: Record<string, unknown>): Promise<RpcResponse> {
  try {
    const res = await fetch('/api/dashboard/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rpc, params }),
    });
    const json = (await res.json()) as RpcResponse;
    if (!res.ok || json?.error) {
      console.error(`[useSkuModal] ${rpc} falhou:`, json?.error ?? res.statusText, params);
    }
    return json ?? {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'exceção';
    console.error(`[useSkuModal] ${rpc} exceção:`, err);
    return { error: msg, data: [] };
  }
}

async function fetchImpacto(sku: string, dataAlteracao: string): Promise<number | null> {
  const res = await callRpc('rpc_sku_modal_impacto_alteracao', {
    p_sku: sku,
    p_data_alteracao: dataAlteracao,
  });
  const raw = res?.data;
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first == null) return null;
    if (typeof first === 'number') return first;
    if (typeof first === 'object') {
      const v = Object.values(first as Record<string, unknown>)[0];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      }
    }
  }
  return null;
}

export function useSkuModal(lojaConfig: LojaConfigEntry[] = []) {
  const [alerta, setAlerta] = useState<Alerta | null>(null);
  const isOpen = alerta !== null;

  const [periodo, setPeriodo] = useState<PeriodoPreset>('30d');
  const [customInicio, setCustomInicio] = useState<string | null>(null);
  const [customFim, setCustomFim] = useState<string | null>(null);
  const [lojasSelecionadas, setLojasSelecionadas] = useState<string[]>([]);
  const [marketplace, setMarketplace] = useState<Marketplace | null>(null);
  const [metricaChart, setMetricaChart] = useState<'quantidade' | 'faturamento'>('quantidade');

  const [serie, setSerie] = useState<SeriePoint[]>([]);
  const [porLojaRaw, setPorLojaRaw] = useState<{ ecommerceNome: string; quantidade: number; faturamento: number; variacaoPercent: number | null }[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [tendencia, setTendencia] = useState<Tendencia | null>(null);
  const [alteracoes, setAlteracoes] = useState<AlteracaoItem[]>([]);
  const [errors, setErrors] = useState<FetchErrorMap>({});
  const [loadingSerie, setLoadingSerie] = useState(false);
  const [loadingLoja, setLoadingLoja] = useState(false);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [loadingAlteracoes, setLoadingAlteracoes] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const fetchIdRef = useRef(0);

  // === Mapas derivados da loja_config ===

  // ecommerce_nome_tiny → { nomeLoja, marketplace }
  const ecommToInfo = useMemo(() => {
    const m = new Map<string, { nomeLoja: string; marketplace: Marketplace | 'Outro' }>();
    for (const c of lojaConfig) {
      const nomeLoja = c.nome_loja || c.nome_exibicao;
      const mkp = normalizeMarketplace(c.marketplace);
      m.set(c.ecommerce_nome_tiny, { nomeLoja, marketplace: mkp });
    }
    return m;
  }, [lojaConfig]);

  // nome_loja → ecommerce_nome_tiny[] (uma nome_loja pode ter múltiplos canais)
  const nomeLojaToEcomm = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of lojaConfig) {
      const key = c.nome_loja || c.nome_exibicao;
      const arr = m.get(key);
      if (arr) arr.push(c.ecommerce_nome_tiny);
      else m.set(key, [c.ecommerce_nome_tiny]);
    }
    return m;
  }, [lojaConfig]);

  // Lista de nome_loja únicos (para o dropdown)
  const lojasDisponiveis = useMemo(
    () => Array.from(nomeLojaToEcomm.keys()).sort(),
    [nomeLojaToEcomm],
  );

  // Lojas do marketplace selecionado (nome_loja[])
  const lojasDoMarketplace = useMemo(() => {
    if (!marketplace) return null;
    const out = new Set<string>();
    for (const c of lojaConfig) {
      if (normalizeMarketplace(c.marketplace) === marketplace) {
        out.add(c.nome_loja || c.nome_exibicao);
      }
    }
    return Array.from(out);
  }, [lojaConfig, marketplace]);

  const datas = useMemo(
    () => calcularDatas(periodo, customInicio, customFim),
    [periodo, customInicio, customFim],
  );

  // Converte nome_loja selecionadas → array de ecommerce_nome_tiny para enviar ao banco.
  // Se marketplace selecionado mas nada específico, usa todas as lojas do marketplace.
  // Retorna null se nenhum filtro (= todas).
  const lojasEfetivasEcomm = useMemo<string[] | null>(() => {
    let nomes: string[] = lojasSelecionadas;

    if (marketplace) {
      const mkpSet = new Set(lojasDoMarketplace ?? []);
      if (lojasSelecionadas.length === 0) {
        nomes = Array.from(mkpSet);
      } else {
        nomes = lojasSelecionadas.filter(n => mkpSet.has(n));
      }
    }

    if (nomes.length === 0) return null;

    const result: string[] = [];
    for (const n of nomes) {
      const ecomms = nomeLojaToEcomm.get(n);
      if (ecomms) result.push(...ecomms);
    }
    return result.length > 0 ? result : null;
  }, [lojasSelecionadas, marketplace, lojasDoMarketplace, nomeLojaToEcomm]);

  const openModal = useCallback((a: Alerta) => {
    setAlerta(a);
    setPeriodo('30d');
    setCustomInicio(null);
    setCustomFim(null);
    setLojasSelecionadas([]);
    setMarketplace(null);
    setMetricaChart('quantidade');
    setSerie([]);
    setPorLojaRaw([]);
    setKpis(null);
    setTendencia(null);
    setAlteracoes([]);
    setErrors({});
  }, []);

  const closeModal = useCallback(() => setAlerta(null), []);

  // Auto-refresh no filtro "hoje" para capturar novas horas
  useEffect(() => {
    if (!isOpen || periodo !== 'hoje') return;
    const interval = setInterval(() => {
      setRefreshTick(t => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, [isOpen, periodo]);

  // Fetch reativo a alerta, datas, lojasEfetivas
  useEffect(() => {
    if (!alerta) return;
    const currentId = ++fetchIdRef.current;
    const skuPai = alerta.sku_pai;

    setLoadingSerie(true);
    setLoadingLoja(true);
    setLoadingKpis(true);
    setLoadingAlteracoes(true);
    setErrors({});

    const isHoje = periodo === 'hoje';

    // Série temporal — usa RPC _hoje (hourly_stats) quando periodo=hoje
    const serieRpc = isHoje ? 'rpc_sku_modal_serie_hoje' : 'rpc_sku_modal_serie_temporal';
    const serieParams: Record<string, unknown> = isHoje
      ? { p_sku_pai: skuPai, p_lojas: lojasEfetivasEcomm }
      : { p_sku_pai: skuPai, p_data_inicio: datas.inicio, p_data_fim: datas.fim, p_lojas: lojasEfetivasEcomm };

    callRpc(serieRpc, serieParams).then(res => {
      if (currentId !== fetchIdRef.current) return;
      if (res.error) setErrors(prev => ({ ...prev, serie: res.error }));

      if (isHoje) {
        const rows = (res.data ?? []) as RpcSerieHoje[];
        setSerie(rows.map(r => ({
          data: `${String(r.out_hora).padStart(2, '0')}h`,
          quantidade: Number(r.out_quantidade) || 0,
          faturamento: Number(r.out_faturamento) || 0,
          pedidos: Number(r.out_pedidos) || 0,
        })));
      } else {
        const rows = (res.data ?? []) as RpcSerie[];
        setSerie(rows.map(r => ({
          data: String(r.out_data),
          quantidade: Number(r.out_quantidade) || 0,
          faturamento: Number(r.out_faturamento) || 0,
          pedidos: Number(r.out_pedidos) || 0,
        })));
      }
      setLoadingSerie(false);
    });

    // Breakdown por loja — variante _hoje quando periodo=hoje
    const lojaRpc = isHoje ? 'rpc_sku_modal_por_loja_hoje' : 'rpc_sku_modal_por_loja';
    const lojaParams: Record<string, unknown> = isHoje
      ? { p_sku_pai: skuPai }
      : { p_sku_pai: skuPai, p_data_inicio: datas.inicio, p_data_fim: datas.fim };

    callRpc(lojaRpc, lojaParams).then(res => {
      if (currentId !== fetchIdRef.current) return;
      if (res.error) setErrors(prev => ({ ...prev, loja: res.error }));
      const rows = (res.data ?? []) as RpcLoja[];
      setPorLojaRaw(rows.map(r => ({
        ecommerceNome: String(r.out_loja),
        quantidade: Number(r.out_quantidade) || 0,
        faturamento: Number(r.out_faturamento) || 0,
        variacaoPercent: r.out_variacao_percent != null ? Number(r.out_variacao_percent) : null,
      })));
      setLoadingLoja(false);
    });

    // KPIs — usa _hoje (hora-a-hora) quando periodo=hoje; senão usa o período completo
    const kpisRpc = isHoje ? 'rpc_sku_modal_kpis_hoje' : 'rpc_sku_modal_kpis';
    const kpisParams: Record<string, unknown> = isHoje
      ? { p_sku_pai: skuPai, p_lojas: lojasEfetivasEcomm }
      : { p_sku_pai: skuPai, p_data_inicio: datas.inicio, p_data_fim: datas.fim, p_lojas: lojasEfetivasEcomm };

    callRpc(kpisRpc, kpisParams).then(res => {
      if (currentId !== fetchIdRef.current) return;
      if (res.error) setErrors(prev => ({ ...prev, kpis: res.error }));
      const rows = (res.data ?? []) as RpcKpisHoje[];
      const r = rows[0];
      setKpis(r ? {
        vendas: Number(r.out_vendas) || 0,
        vendasAnterior: Number(r.out_vendas_anterior) || 0,
        faturamento: Number(r.out_faturamento) || 0,
        faturamentoAnterior: Number(r.out_faturamento_anterior) || 0,
        ticketMedio: Number(r.out_ticket_medio) || 0,
      } : { vendas: 0, vendasAnterior: 0, faturamento: 0, faturamentoAnterior: 0, ticketMedio: 0 });
      setLoadingKpis(false);
    });

    // Tendência é SKU-level (detectada pela IA de manhã), não deve depender
    // do filtro de lojas — sempre chama com p_lojas NULL para pegar o streak global.
    callRpc('rpc_alertas_tendencia', { p_lojas: null }).then(res => {
      if (currentId !== fetchIdRef.current) return;
      const rows = (res.data ?? []) as RpcTendencia[];
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
      const res = await callRpc('rpc_alteracoes_por_sku', { p_sku: skuPai, p_dias_atras: diasJanela });
      if (currentId !== fetchIdRef.current) return;
      if (res.error) setErrors(prev => ({ ...prev, alteracoes: res.error }));

      const lista = (res.data ?? []) as RpcAlteracaoSku[];
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
  }, [alerta, periodo, datas, lojasEfetivasEcomm, refreshTick]);

  // Agrega porLojaRaw (em ecommerce_nome) → por nome_loja de display
  const porLoja = useMemo<LojaRow[]>(() => {
    const map = new Map<string, LojaRow & { _faturamentoAnt: number; _temVariacao: boolean }>();

    for (const r of porLojaRaw) {
      const info = ecommToInfo.get(r.ecommerceNome);
      const nomeLoja = info?.nomeLoja ?? r.ecommerceNome;
      const mkp = info?.marketplace ?? 'Outro';

      // Recomposição da variação: se a RPC deu X%, o faturamento anterior = atual / (1 + X/100)
      // Esse valor é necessário para agregar corretamente quando múltiplos ecomm nomes viram a mesma nome_loja.
      const prev = map.get(nomeLoja);
      if (prev) {
        const novoAnt = r.variacaoPercent != null && r.variacaoPercent !== -100
          ? r.faturamento / (1 + r.variacaoPercent / 100)
          : 0;
        prev.quantidade += r.quantidade;
        prev.faturamento += r.faturamento;
        prev._faturamentoAnt += novoAnt;
        if (r.variacaoPercent != null) prev._temVariacao = true;
      } else {
        const ant = r.variacaoPercent != null && r.variacaoPercent !== -100
          ? r.faturamento / (1 + r.variacaoPercent / 100)
          : 0;
        map.set(nomeLoja, {
          loja: nomeLoja,
          marketplace: mkp,
          quantidade: r.quantidade,
          faturamento: r.faturamento,
          variacaoPercent: null,
          _faturamentoAnt: ant,
          _temVariacao: r.variacaoPercent != null,
        });
      }
    }

    const rows = Array.from(map.values()).map(r => ({
      loja: r.loja,
      marketplace: r.marketplace,
      quantidade: r.quantidade,
      faturamento: r.faturamento,
      variacaoPercent: r._temVariacao && r._faturamentoAnt > 0
        ? Math.round(((r.faturamento - r._faturamentoAnt) / r._faturamentoAnt) * 1000) / 10
        : null,
    }));

    return rows.sort((a, b) => b.faturamento - a.faturamento);
  }, [porLojaRaw, ecommToInfo]);

  // Pizza por marketplace
  const porMarketplace = useMemo<MarketplaceSlice[]>(() => {
    const acc = new Map<Marketplace | 'Outro', number>();
    let total = 0;
    for (const l of porLoja) {
      acc.set(l.marketplace, (acc.get(l.marketplace) ?? 0) + l.faturamento);
      total += l.faturamento;
    }
    if (total === 0) return [];
    return Array.from(acc.entries())
      .map(([mkp, fat]) => ({
        marketplace: mkp,
        faturamento: fat,
        percentual: Math.round((fat / total) * 1000) / 10,
      }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }, [porLoja]);

  const loading = loadingSerie || loadingLoja || loadingKpis || loadingAlteracoes;

  // Deltas do header derivados dos KPIs — reagem ao filtro do modal
  const headerDeltas = useMemo<HeaderDeltas | null>(() => {
    if (!kpis) return null;
    const deltaPecas = kpis.vendas - kpis.vendasAnterior;
    const deltaFaturamento = kpis.faturamento - kpis.faturamentoAnterior;
    const variacaoPct = kpis.faturamentoAnterior > 0
      ? Math.round(((kpis.faturamento - kpis.faturamentoAnterior) / kpis.faturamentoAnterior) * 1000) / 10
      : null;
    return { deltaPecas, deltaFaturamento, variacaoPct };
  }, [kpis]);

  return {
    alerta, isOpen,
    periodo, setPeriodo,
    customInicio, setCustomInicio,
    customFim, setCustomFim,
    lojasSelecionadas, setLojasSelecionadas,
    marketplace, setMarketplace,
    metricaChart, setMetricaChart,
    datas,
    lojasDisponiveis,
    serie,
    porLoja,
    porMarketplace,
    kpis,
    headerDeltas,
    tendencia,
    alteracoes,
    errors,
    loading,
    loadingSerie,
    loadingLoja,
    loadingKpis,
    loadingAlteracoes,
    openModal,
    closeModal,
  };
}
