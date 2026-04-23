'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// Página Lucro e Prejuízo — Etapa 3: visão por pedido.
// Consome /api/lucro e /api/shopee/shops. Configs (toggles de custos,
// tipo de margem, limiares) persistem em localStorage.

// ============================================================
// Tipos
// ============================================================

type Period = 'today' | 'yesterday' | '7d' | '15d' | 'month';
type Filtro = 'todos' | 'com_lucro' | 'com_prejuizo' | 'saudavel' | 'atencao' | 'sem_cmv';
type Visao = 'pedidos' | 'skus';
type MargemTipo = 'bruta' | 'operacional' | 'real';
type Ordem = 'lucro' | 'margem' | 'venda' | 'cmv' | 'data';
type Direcao = 'asc' | 'desc';
type StatusPedido = 'saudavel' | 'atencao' | 'prejuizo' | 'sem_cmv';

interface Config {
  cmvAtivo: boolean;
  adsAtivo: boolean;
  fbsAtivo: boolean;
  margemTipo: MargemTipo;
  limiarSaudavel: number;
  limiarAtencao: number;
}

interface Pedido {
  order_sn: string;
  data: string;
  skus: string[];
  sku_pais: string[];
  qtd_itens: number;
  venda: number;
  cmv: number;
  comissao: number;
  taxa_servico: number;
  afiliado: number;
  cupom_seller: number;
  frete_devolucao: number;
  difal: number;
  rateio_ads: number;
  rateio_fbs: number;
  receita_liquida: number;
  lucro: number;
  margem_pct: number;
  status: StatusPedido;
  tem_cmv: boolean;
  metodo_pagamento: string | null;
  tem_devolucao: boolean;
  tem_afiliado: boolean;
  breakdown: {
    cmv_pct: number;
    comissao_pct: number;
    taxa_pct: number;
    afiliado_pct: number;
    lucro_pct: number;
  };
}

interface SkuRow {
  sku_pai: string;
  descricao: string;
  qtd_vendida: number;
  venda_total: number;
  cmv_total: number;
  lucro_total: number;
  margem_media: number;
  pedidos_negativos: number;
  pct_negativos: number;
  tem_cmv: boolean;
  status: StatusPedido;
}

interface Resumo {
  lucro_total: number;
  prejuizo_total: number;
  pedidos_lucrativos: number;
  pedidos_negativos: number;
  pct_lucrativos: number;
  cmv_total: number;
  margem_media: number;
  melhor_pedido: { order_sn: string; lucro: number; margem: number } | null;
  pior_pedido: { order_sn: string; lucro: number; margem: number } | null;
}

interface LucroResponse {
  resumo: Resumo;
  pedidos?: Pedido[];
  skus?: SkuRow[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

interface ShopInfo {
  shop_id: number;
  shop_name: string | null;
}

// ============================================================
// Constantes
// ============================================================

const COLORS = {
  azul: '#378ADD',
  verde: '#1D9E75',
  vermelho: '#E24B4A',
  amber: '#BA7517',
  amberClaro: '#EF9F27',
  coral: '#D85A30',
  cinza: '#888780',
};

const PERIOD_OPTIONS: Array<{ key: Period; label: string }> = [
  { key: 'today',     label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d',        label: '7 dias' },
  { key: '15d',       label: '15 dias' },
  { key: 'month',     label: 'Mês atual' },
];

const FILTRO_OPTIONS: Array<{ key: Filtro; label: string }> = [
  { key: 'todos',        label: 'Todos' },
  { key: 'com_lucro',    label: 'Com lucro' },
  { key: 'com_prejuizo', label: 'Com prejuízo' },
  { key: 'saudavel',     label: 'Saudável' },
  { key: 'atencao',      label: 'Atenção' },
  { key: 'sem_cmv',      label: 'Sem CMV' },
];

const DEFAULT_CONFIG: Config = {
  cmvAtivo: true,
  adsAtivo: false,
  fbsAtivo: false,
  margemTipo: 'real',
  limiarSaudavel: 15,
  limiarAtencao: 0,
};

const CONFIG_KEY = 'naraka-bi-lucro-config';
const PAGE_LIMIT = 50;

// ============================================================
// Helpers
// ============================================================

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return BRL.format(n);
}

function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}%`;
}

function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}

function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function loadConfig(): Config {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<Config>;
    return {
      cmvAtivo: parsed.cmvAtivo ?? DEFAULT_CONFIG.cmvAtivo,
      adsAtivo: parsed.adsAtivo ?? DEFAULT_CONFIG.adsAtivo,
      fbsAtivo: parsed.fbsAtivo ?? DEFAULT_CONFIG.fbsAtivo,
      margemTipo: parsed.margemTipo ?? DEFAULT_CONFIG.margemTipo,
      limiarSaudavel: parsed.limiarSaudavel ?? DEFAULT_CONFIG.limiarSaudavel,
      limiarAtencao: parsed.limiarAtencao ?? DEFAULT_CONFIG.limiarAtencao,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: Config): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    // ignora — pode estar em modo private, sem quota, etc.
  }
}

function custosString(c: Config): string {
  const parts: string[] = [];
  if (c.cmvAtivo) parts.push('cmv');
  if (c.adsAtivo) parts.push('ads');
  if (c.fbsAtivo) parts.push('fbs');
  return parts.join(',');
}

function custosBadge(c: Config): string {
  const parts: string[] = [];
  if (c.cmvAtivo) parts.push('CMV');
  if (c.adsAtivo) parts.push('Ads');
  if (c.fbsAtivo) parts.push('FBS');
  if (parts.length === 0) return 'Nenhum custo extra';
  return parts.join(' + ');
}

function margemLabel(t: MargemTipo): string {
  return t === 'bruta' ? 'bruta' : t === 'operacional' ? 'operacional' : 'real';
}

// ============================================================
// Componente principal
// ============================================================

export default function LucroPrejuizoPage() {
  // ---- Estado ----
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  const [period, setPeriod] = useState<Period>('7d');
  const [shopFilter, setShopFilter] = useState<string>('all');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [visao, setVisao] = useState<Visao>('pedidos');
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('lucro');
  const [direcao, setDirecao] = useState<Direcao>('desc');
  const [page, setPage] = useState(1);

  const [shops, setShops] = useState<ShopInfo[]>([]);
  const [data, setData] = useState<LucroResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());

  // ---- Hidratação da config ----
  useEffect(() => {
    setConfig(loadConfig());
    setConfigLoaded(true);
  }, []);

  // ---- Busca com debounce (400ms) ----
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 400);
    return () => clearTimeout(t);
  }, [busca]);

  // ---- Fetch de lojas ----
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/shopee/shops', { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) setShops((json.shops ?? []) as ShopInfo[]);
      } catch {
        // silencioso — dropdown fica só com "Todas"
      }
    })();
  }, []);

  // ---- Fetch principal ----
  const fetchLucro = useCallback(async () => {
    if (!configLoaded) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period,
        shop_id: shopFilter,
        visao,
        custos: custosString(config) || 'none',
        margem: config.margemTipo,
        filtro,
        ordem,
        direcao,
        page: String(page),
        limit: String(PAGE_LIMIT),
      });
      if (buscaDebounced) params.set('busca', buscaDebounced);

      const res = await fetch(`/api/lucro?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as LucroResponse);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [configLoaded, period, shopFilter, visao, config, filtro, ordem, direcao, page, buscaDebounced]);

  useEffect(() => { fetchLucro(); }, [fetchLucro]);

  // Reset para página 1 quando qualquer filtro muda (exceto page)
  useEffect(() => {
    setPage(1);
  }, [period, shopFilter, filtro, visao, buscaDebounced, ordem, direcao, config]);

  // ---- Handlers ordenação ----
  function toggleOrdem(col: Ordem) {
    if (ordem === col) {
      setDirecao(direcao === 'asc' ? 'desc' : 'asc');
    } else {
      setOrdem(col);
      setDirecao('desc');
    }
  }

  // ---- Render ----
  const resumo = data?.resumo;
  const pedidos = data?.pedidos ?? [];
  const skus = data?.skus ?? [];
  const pagination = data?.pagination;

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Lucro e prejuízo</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Atualizado às {fmtTime(lastUpdate)} · Margem {margemLabel(config.margemTipo)}
          <span
            className="ml-2 inline-block text-[10px] px-1.5 py-0.5 rounded font-medium"
            style={{ background: 'rgba(55,138,221,0.12)', color: COLORS.azul }}
          >
            {custosBadge(config)}
          </span>
        </p>
      </div>

      {/* Filtros inline */}
      <div className="card p-3 rounded-lg mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                period === p.key
                  ? 'bg-[#378ADD] text-white'
                  : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <select
          value={shopFilter}
          onChange={e => setShopFilter(e.target.value)}
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
        >
          <option value="all">Todas as lojas</option>
          {shops.map(s => (
            <option key={s.shop_id} value={s.shop_id}>
              {s.shop_name || `Shop ${s.shop_id}`}
            </option>
          ))}
        </select>

        <select
          value={filtro}
          onChange={e => setFiltro(e.target.value as Filtro)}
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
        >
          {FILTRO_OPTIONS.map(f => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>

        <div className="flex rounded border border-current/15 overflow-hidden">
          {(['pedidos', 'skus'] as Visao[]).map(v => (
            <button
              key={v}
              onClick={() => setVisao(v)}
              className="px-2.5 py-1 text-xs transition-colors"
              style={visao === v ? { background: COLORS.azul, color: 'white' } : {}}
            >
              {v === 'pedidos' ? 'Pedidos' : 'SKUs'}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar..."
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs w-36"
        />

        <button
          onClick={() => setConfigOpen(true)}
          title="Configurações"
          className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <GearIcon />
        </button>
      </div>

      {error && (
        <div className="card p-3 rounded-lg mb-4 text-xs" style={{ color: COLORS.vermelho }}>
          Erro: {error}
        </div>
      )}

      {/* KPIs */}
      {loading && !resumo ? (
        <SkeletonKpis />
      ) : resumo ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          <KpiCard
            label="Lucro total"
            value={fmtBRL(resumo.lucro_total)}
            valueColor={COLORS.verde}
            sub={`Margem ${margemLabel(config.margemTipo)} ${fmtPct(resumo.margem_media)}`}
          />
          <KpiCard
            label="Pedidos lucrativos"
            value={fmtInt(resumo.pedidos_lucrativos)}
            valueColor={COLORS.verde}
            sub={`${fmtPct(resumo.pct_lucrativos)} dos pedidos`}
          />
          <KpiCard
            label="Prejuízo total"
            value={fmtBRL(resumo.prejuizo_total)}
            valueColor={COLORS.vermelho}
            sub={`${fmtInt(resumo.pedidos_negativos)} pedidos · ${fmtPct(100 - resumo.pct_lucrativos)}`}
          />
          <KpiCard
            label="CMV total"
            value={fmtBRL(resumo.cmv_total)}
            sub={
              pagination && pagination.total > 0
                ? `Base: ${fmtInt(pagination.total)} pedidos`
                : 'Base: 0 pedidos'
            }
          />
          <KpiCard
            label="Melhor pedido"
            value={resumo.melhor_pedido ? fmtBRL(resumo.melhor_pedido.lucro) : '—'}
            valueColor={COLORS.verde}
            sub={
              resumo.melhor_pedido
                ? `Margem ${fmtPct(resumo.melhor_pedido.margem)} · ${resumo.melhor_pedido.order_sn.slice(-8)}`
                : 'Sem dados no período'
            }
          />
          <KpiCard
            label="Pior pedido"
            value={resumo.pior_pedido ? fmtBRL(resumo.pior_pedido.lucro) : '—'}
            valueColor={COLORS.vermelho}
            sub={
              resumo.pior_pedido
                ? `Margem ${fmtPct(resumo.pior_pedido.margem)} · ${inferCausa(pedidos, resumo.pior_pedido.order_sn)}`
                : 'Sem dados no período'
            }
          />
        </div>
      ) : null}

      {/* Tabela */}
      {visao === 'pedidos' ? (
        <PedidosTable
          loading={loading}
          pedidos={pedidos}
          ordem={ordem}
          direcao={direcao}
          onSort={toggleOrdem}
        />
      ) : (
        <SkusTable loading={loading} skus={skus} />
      )}

      {/* Paginação */}
      {pagination && pagination.total > 0 && (
        <Pagination
          pagination={pagination}
          onPrev={() => setPage(p => Math.max(1, p - 1))}
          onNext={() => setPage(p => Math.min(pagination.total_pages, p + 1))}
          loading={loading}
          visao={visao}
        />
      )}

      {/* Modal de configurações */}
      {configOpen && (
        <ConfigModal
          initial={config}
          onClose={() => setConfigOpen(false)}
          onSave={next => {
            setConfig(next);
            saveConfig(next);
            setConfigOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Subcomponentes
// ============================================================

function KpiCard({
  label, value, valueColor, sub,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
}) {
  return (
    <div className="card p-4 rounded-lg">
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <div className="text-lg font-medium mb-1" style={valueColor ? { color: valueColor } : {}}>
        {value}
      </div>
      {sub && <div className="text-[10px] opacity-60">{sub}</div>}
    </div>
  );
}

function SkeletonKpis() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card p-4 rounded-lg animate-pulse">
          <div className="h-3 w-16 bg-current/10 rounded mb-2" />
          <div className="h-5 w-24 bg-current/10 rounded mb-1" />
          <div className="h-2 w-20 bg-current/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function inferCausa(pedidos: Pedido[], orderSn: string): string {
  const p = pedidos.find(pp => pp.order_sn === orderSn);
  if (!p) return '—';
  if (p.tem_devolucao) return 'Devolução';
  if (!p.tem_cmv) return 'Sem CMV';
  if (p.breakdown.afiliado_pct > 10) return 'Afiliado alto';
  if (p.breakdown.cmv_pct > 70) return 'CMV alto';
  if (p.breakdown.comissao_pct > 20) return 'Comissão alta';
  return 'Margem baixa';
}

// ============================================================
// Tabela de pedidos
// ============================================================

function PedidosTable({
  loading, pedidos, ordem, direcao, onSort,
}: {
  loading: boolean;
  pedidos: Pedido[];
  ordem: Ordem;
  direcao: Direcao;
  onSort: (col: Ordem) => void;
}) {
  return (
    <div className="card rounded-lg mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-current/10 flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60">
          Detalhamento por pedido
        </h2>
        <div className="flex items-center gap-3 text-[10px] opacity-70">
          <LegendDot color={COLORS.verde} label="CMV" />
          <LegendDot color={COLORS.vermelho} label="Comissão" />
          <LegendDot color={COLORS.amber} label="Taxa" />
          <LegendDot color={COLORS.coral} label="Afiliado" />
          <LegendDot color={COLORS.azul} label="Lucro" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left opacity-50 border-b border-current/10">
              <th className="px-3 py-2 font-medium">Pedido</th>
              <SortableTh label="Data"    col="data"   ordem={ordem} direcao={direcao} onSort={onSort} />
              <SortableTh label="Venda"   col="venda"  ordem={ordem} direcao={direcao} onSort={onSort} align="right" />
              <SortableTh label="CMV"     col="cmv"    ordem={ordem} direcao={direcao} onSort={onSort} align="right" />
              <th className="px-3 py-2 font-medium text-right">Taxas</th>
              <th className="px-3 py-2 font-medium text-right">Receita líq.</th>
              <SortableTh label="Lucro"   col="lucro"  ordem={ordem} direcao={direcao} onSort={onSort} align="right" />
              <SortableTh label="Margem"  col="margem" ordem={ordem} direcao={direcao} onSort={onSort} align="right" />
              <th className="px-3 py-2 font-medium">Composição</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && pedidos.length === 0 && (
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-t border-current/5 animate-pulse">
                    <td colSpan={10} className="px-3 py-3">
                      <div className="h-3 w-full bg-current/5 rounded" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && pedidos.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-[11px] opacity-60">
                  Nenhum pedido encontrado para o período selecionado.
                </td>
              </tr>
            )}
            {pedidos.map(p => {
              const taxas = p.comissao + p.taxa_servico + p.afiliado + p.cupom_seller + p.frete_devolucao;
              const bgLucro =
                p.lucro > 0 ? 'rgba(29,158,117,0.05)'
                : p.lucro < 0 ? 'rgba(226,75,74,0.05)'
                : 'transparent';
              return (
                <tr
                  key={`${p.order_sn}-${p.data}`}
                  className="border-t border-current/5 hover:bg-current/[0.02] transition-colors"
                  style={{ background: bgLucro }}
                >
                  <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap" title={p.order_sn}>
                    {p.order_sn.length > 10 ? `…${p.order_sn.slice(-10)}` : p.order_sn}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap opacity-80">{fmtDateBR(p.data)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{fmtBRL(p.venda)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: p.cmv === 0 ? COLORS.cinza : undefined }}>
                    {fmtBRL(p.cmv)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" style={{ color: COLORS.vermelho }}>
                    −{fmtBRL(taxas)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{fmtBRL(p.receita_liquida)}</td>
                  <td
                    className="px-3 py-2 text-right whitespace-nowrap font-medium"
                    style={{ color: p.lucro > 0 ? COLORS.verde : p.lucro < 0 ? COLORS.vermelho : undefined }}
                  >
                    {fmtBRL(p.lucro)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <MargemBadge margem={p.margem_pct} />
                  </td>
                  <td className="px-3 py-2">
                    <CompositionBar pedido={p} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function SortableTh({
  label, col, ordem, direcao, onSort, align = 'left',
}: {
  label: string;
  col: Ordem;
  ordem: Ordem;
  direcao: Direcao;
  onSort: (col: Ordem) => void;
  align?: 'left' | 'right';
}) {
  const active = ordem === col;
  const arrow = active ? (direcao === 'asc' ? ' ↑' : ' ↓') : '';
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:opacity-80 ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(col)}
    >
      {label}{arrow}
    </th>
  );
}

function MargemBadge({ margem }: { margem: number }) {
  let color = COLORS.verde;
  let bg = 'rgba(29,158,117,0.12)';
  if (margem < 0) { color = COLORS.vermelho; bg = 'rgba(226,75,74,0.12)'; }
  else if (margem < 15) { color = COLORS.amber; bg = 'rgba(239,159,39,0.14)'; }
  return (
    <span
      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {fmtPct(margem)}
    </span>
  );
}

function StatusBadge({ status }: { status: StatusPedido }) {
  const map: Record<StatusPedido, { label: string; bg: string; color: string }> = {
    saudavel: { label: 'Saudável', bg: 'rgba(29,158,117,0.12)', color: COLORS.verde },
    atencao:  { label: 'Atenção',  bg: 'rgba(239,159,39,0.14)', color: COLORS.amber },
    prejuizo: { label: 'Prejuízo', bg: 'rgba(226,75,74,0.12)',  color: COLORS.vermelho },
    sem_cmv:  { label: 'Sem CMV',  bg: 'rgba(136,135,128,0.15)', color: COLORS.cinza },
  };
  const s = map[status] ?? map.sem_cmv;
  return (
    <span
      className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function CompositionBar({ pedido }: { pedido: Pedido }) {
  // Se prejuízo, barra 100% vermelha — sinaliza que custos > receita.
  if (pedido.lucro < 0 || pedido.venda <= 0) {
    return (
      <div className="h-2 w-[100px] rounded-sm overflow-hidden" style={{ background: COLORS.vermelho }} />
    );
  }

  // Proporções sobre a venda. Lucro = o que sobra.
  const venda = pedido.venda;
  const cmv = Math.max(0, pedido.cmv) / venda * 100;
  const comissao = Math.max(0, pedido.comissao) / venda * 100;
  const taxa = Math.max(0, pedido.taxa_servico) / venda * 100;
  const afiliado = Math.max(0, pedido.afiliado) / venda * 100;
  const lucro = Math.max(0, pedido.lucro) / venda * 100;
  const total = cmv + comissao + taxa + afiliado + lucro;
  // Normaliza para somar 100 (descarta fretes/cupons/DIFAL do visual — ficam implícitos).
  const factor = total > 0 ? 100 / total : 0;

  const segments: Array<{ w: number; color: string; title: string }> = [
    { w: cmv * factor,      color: COLORS.verde,    title: `CMV ${fmtPct(cmv, 0)}` },
    { w: comissao * factor, color: COLORS.vermelho, title: `Comissão ${fmtPct(comissao, 0)}` },
    { w: taxa * factor,     color: COLORS.amber,    title: `Taxa ${fmtPct(taxa, 0)}` },
    { w: afiliado * factor, color: COLORS.coral,    title: `Afiliado ${fmtPct(afiliado, 0)}` },
    { w: lucro * factor,    color: COLORS.azul,     title: `Lucro ${fmtPct(lucro, 0)}` },
  ];

  return (
    <div className="flex h-2 w-[100px] rounded-sm overflow-hidden" title={segments.map(s => s.title).join(' · ')}>
      {segments.map((s, i) => s.w > 0 && (
        <div key={i} style={{ width: `${s.w}%`, background: s.color }} />
      ))}
    </div>
  );
}

// ============================================================
// Tabela de SKUs (visão simplificada — comparte filtros/API)
// ============================================================

function SkusTable({ loading, skus }: { loading: boolean; skus: SkuRow[] }) {
  return (
    <div className="card rounded-lg mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-current/10">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60">
          Detalhamento por SKU pai
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left opacity-50 border-b border-current/10">
              <th className="px-3 py-2 font-medium">SKU pai</th>
              <th className="px-3 py-2 font-medium text-right">Qtd vendida</th>
              <th className="px-3 py-2 font-medium text-right">Venda total</th>
              <th className="px-3 py-2 font-medium text-right">CMV total</th>
              <th className="px-3 py-2 font-medium text-right">Lucro total</th>
              <th className="px-3 py-2 font-medium text-right">Margem média</th>
              <th className="px-3 py-2 font-medium text-right">Pedidos neg.</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && skus.length === 0 && (
              <>
                {Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-current/5 animate-pulse">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="h-3 w-full bg-current/5 rounded" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && skus.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[11px] opacity-60">
                  Nenhum SKU encontrado para o período selecionado.
                </td>
              </tr>
            )}
            {skus.map(s => (
              <tr key={s.sku_pai} className="border-t border-current/5 hover:bg-current/[0.02]">
                <td className="px-3 py-2 font-mono text-[11px]">{s.sku_pai}</td>
                <td className="px-3 py-2 text-right">{fmtInt(s.qtd_vendida)}</td>
                <td className="px-3 py-2 text-right">{fmtBRL(s.venda_total)}</td>
                <td className="px-3 py-2 text-right">{fmtBRL(s.cmv_total)}</td>
                <td className="px-3 py-2 text-right font-medium"
                    style={{ color: s.lucro_total > 0 ? COLORS.verde : s.lucro_total < 0 ? COLORS.vermelho : undefined }}>
                  {fmtBRL(s.lucro_total)}
                </td>
                <td className="px-3 py-2 text-right"><MargemBadge margem={s.margem_media} /></td>
                <td className="px-3 py-2 text-right">
                  {s.pedidos_negativos}{' '}
                  <span className="opacity-50 text-[10px]">({fmtPct(s.pct_negativos)})</span>
                </td>
                <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// Paginação
// ============================================================

function Pagination({
  pagination, onPrev, onNext, loading, visao,
}: {
  pagination: { page: number; limit: number; total: number; total_pages: number };
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
  visao: Visao;
}) {
  const start = (pagination.page - 1) * pagination.limit + 1;
  const end = Math.min(pagination.page * pagination.limit, pagination.total);
  const label = visao === 'pedidos' ? 'pedidos' : 'SKUs';
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 px-1">
      <span className="text-[11px] opacity-60">
        Mostrando {fmtInt(start)}–{fmtInt(end)} de {fmtInt(pagination.total)} {label}
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onPrev}
          disabled={loading || pagination.page <= 1}
          className="px-3 py-1 text-xs rounded border border-current/15 hover:border-current/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Anterior
        </button>
        <span className="text-[11px] opacity-70">
          Página {pagination.page} de {pagination.total_pages}
        </span>
        <button
          onClick={onNext}
          disabled={loading || pagination.page >= pagination.total_pages}
          className="px-3 py-1 text-xs rounded border border-current/15 hover:border-current/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Próximo →
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Modal de configurações
// ============================================================

function ConfigModal({
  initial, onClose, onSave,
}: {
  initial: Config;
  onClose: () => void;
  onSave: (c: Config) => void;
}) {
  const [draft, setDraft] = useState<Config>(initial);

  const canSave = useMemo(() =>
    draft.limiarSaudavel > draft.limiarAtencao,
    [draft],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-lg w-full max-w-md max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 pb-3 border-b border-current/10 shrink-0 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Configurações de lucro</h3>
            <p className="text-[10px] opacity-50 mt-0.5">Salvas localmente no seu navegador</p>
          </div>
          <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-5">
          {/* ============ Custos ============ */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider opacity-60 mb-2">
              Custos incluídos na margem
            </h4>
            <div className="space-y-1.5">
              <CheckboxFixed label="Comissão Shopee" hint="direto" />
              <CheckboxFixed label="Taxa de serviço" hint="direto" />
              <CheckboxFixed label="Afiliado" hint="direto" />
              <CheckboxFixed label="Cupom seller" hint="direto" />
              <CheckboxFixed label="Frete devolução" hint="direto" />
              <CheckboxFixed label="DIFAL" hint="por pedido" />
              <CheckboxToggle
                label="CMV"
                hint="custo de mercadoria"
                checked={draft.cmvAtivo}
                onChange={v => setDraft({ ...draft, cmvAtivo: v })}
              />
              <CheckboxToggle
                label="Ads"
                hint="rateio proporcional/dia"
                checked={draft.adsAtivo}
                onChange={v => setDraft({ ...draft, adsAtivo: v })}
              />
              <CheckboxToggle
                label="FBS"
                hint="rateio proporcional/mês"
                checked={draft.fbsAtivo}
                onChange={v => setDraft({ ...draft, fbsAtivo: v })}
              />
            </div>
          </div>

          {/* ============ Margem ============ */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider opacity-60 mb-2">
              Tipo de margem padrão
            </h4>
            <div className="space-y-1.5">
              <Radio
                name="margem"
                label="Bruta"
                hint="venda − CMV"
                checked={draft.margemTipo === 'bruta'}
                onChange={() => setDraft({ ...draft, margemTipo: 'bruta' })}
              />
              <Radio
                name="margem"
                label="Operacional"
                hint="escrow − CMV"
                checked={draft.margemTipo === 'operacional'}
                onChange={() => setDraft({ ...draft, margemTipo: 'operacional' })}
              />
              <Radio
                name="margem"
                label="Real"
                hint="escrow − CMV − rateios"
                checked={draft.margemTipo === 'real'}
                onChange={() => setDraft({ ...draft, margemTipo: 'real' })}
              />
            </div>
          </div>

          {/* ============ Limiares ============ */}
          <div>
            <h4 className="text-[10px] uppercase tracking-wider opacity-60 mb-2">
              Limiares de classificação
            </h4>
            <div className="space-y-2 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span>Saudável: margem acima de</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    value={draft.limiarSaudavel}
                    onChange={e => setDraft({ ...draft, limiarSaudavel: Number(e.target.value) })}
                    className="w-14 px-2 py-1 text-xs rounded border border-current/15 bg-transparent text-right"
                  />
                  <span>%</span>
                </span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span>Atenção: entre limiares e</span>
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    value={draft.limiarAtencao}
                    onChange={e => setDraft({ ...draft, limiarAtencao: Number(e.target.value) })}
                    className="w-14 px-2 py-1 text-xs rounded border border-current/15 bg-transparent text-right"
                  />
                  <span>%</span>
                </span>
              </label>
              <p className="text-[10px] opacity-50">
                Prejuízo: margem abaixo de {draft.limiarAtencao}%
              </p>
              {!canSave && (
                <p className="text-[10px]" style={{ color: COLORS.vermelho }}>
                  O limite de saudável deve ser maior que o de atenção.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-current/10 shrink-0 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!canSave}
            className="px-3 py-1.5 text-xs rounded-md bg-[#378ADD] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckboxFixed({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center justify-between text-xs opacity-60">
      <span className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px]"
              style={{ background: 'rgba(29,158,117,0.12)', color: COLORS.verde }}>✓</span>
        {label}
      </span>
      <span className="text-[10px] opacity-70">{hint}</span>
    </div>
  );
}

function CheckboxToggle({
  label, hint, checked, onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs cursor-pointer">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 accent-[#378ADD]"
        />
        {label}
      </span>
      <span className="text-[10px] opacity-60">{hint}</span>
    </label>
  );
}

function Radio({
  name, label, hint, checked, onChange,
}: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-center justify-between text-xs cursor-pointer">
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          checked={checked}
          onChange={onChange}
          className="w-4 h-4 accent-[#378ADD]"
        />
        {label}
      </span>
      <span className="text-[10px] opacity-60">{hint}</span>
    </label>
  );
}
