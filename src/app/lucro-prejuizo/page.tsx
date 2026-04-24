'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';

// Página Lucro e Prejuízo — Etapa 3: visão por pedido.
// Consome /api/lucro e /api/shopee/shops. Configs (toggles de custos,
// tipo de margem, limiares) persistem em localStorage.

// ============================================================
// Tipos
// ============================================================

type Period = 'today' | 'yesterday' | '7d' | '15d' | 'month';
type Filtro = 'todos' | 'com_lucro' | 'com_prejuizo' | 'saudavel' | 'atencao' | 'sem_cmv';
type FiltroDevolucao = 'todos' | 'sem' | 'com';
type Visao = 'pedidos' | 'skus';
type MargemTipo = 'bruta' | 'operacional' | 'real';
type Ordem = 'lucro' | 'margem' | 'venda' | 'cmv' | 'data';
type Direcao = 'asc' | 'desc';
type StatusPedido = 'saudavel' | 'atencao' | 'prejuizo' | 'sem_cmv';
type OrdemSkus = 'lucro_desc' | 'lucro_asc' | 'qtd_desc' | 'margem_asc';

interface ItemDetalhe {
  sku: string;
  descricao: string | null;
  quantidade: number;
  cmv_unitario: number;
}

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

const FILTRO_DEVOLUCAO_OPTIONS: Array<{ key: FiltroDevolucao; label: string }> = [
  { key: 'todos', label: 'Todos os pedidos' },
  { key: 'sem',   label: 'Sem devolução' },
  { key: 'com',   label: 'Com devolução' },
];

const ORDEM_SKUS_OPTIONS: Array<{ key: OrdemSkus; label: string }> = [
  { key: 'lucro_desc',  label: 'Maior lucro' },
  { key: 'lucro_asc',   label: 'Maior prejuízo' },
  { key: 'qtd_desc',    label: 'Maior volume' },
  { key: 'margem_asc',  label: 'Menor margem' },
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
  const [filtroDevolucao, setFiltroDevolucao] = useState<FiltroDevolucao>('todos');
  const [visao, setVisao] = useState<Visao>('pedidos');
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('lucro');
  const [direcao, setDirecao] = useState<Direcao>('desc');
  const [ordemSkus, setOrdemSkus] = useState<OrdemSkus>('lucro_desc');
  const [page, setPage] = useState(1);

  // Expansão de linha (apenas 1 por vez) + cache de itens por order_sn.
  const [expandedOrderSn, setExpandedOrderSn] = useState<string | null>(null);
  const [itensCache, setItensCache] = useState<Map<string, ItemDetalhe[]>>(new Map());
  const [itensLoading, setItensLoading] = useState<string | null>(null);

  // Modal de detalhe do SKU
  const [skuDetalhe, setSkuDetalhe] = useState<SkuRow | null>(null);

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
  }, [period, shopFilter, filtro, filtroDevolucao, visao, buscaDebounced, ordem, direcao, config]);

  // Fechar expansão e zerar cache quando o conjunto de pedidos muda
  useEffect(() => {
    setExpandedOrderSn(null);
  }, [period, shopFilter, filtro, filtroDevolucao, visao, buscaDebounced, page]);

  // Handler: expandir/recolher linha + lazy-load itens
  const toggleExpand = useCallback(async (pedido: Pedido) => {
    if (expandedOrderSn === pedido.order_sn) {
      setExpandedOrderSn(null);
      return;
    }
    setExpandedOrderSn(pedido.order_sn);
    if (itensCache.has(pedido.order_sn)) return;

    // shop_id do pedido não está no summary por linha; a UI filtra por shop
    // ou mostra "all" — quando "all", tentamos usar o shop_id do primeiro
    // shop cadastrado (melhor esforço; o endpoint vai responder com [] se
    // não achar).
    const shopId = shopFilter === 'all'
      ? (shops[0]?.shop_id ?? 0)
      : Number(shopFilter);
    if (!shopId) return;

    setItensLoading(pedido.order_sn);
    try {
      const res = await fetch(
        `/api/lucro/pedido-itens?order_sn=${encodeURIComponent(pedido.order_sn)}&shop_id=${shopId}`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (res.ok) {
        setItensCache(prev => {
          const next = new Map(prev);
          next.set(pedido.order_sn, (json.itens ?? []) as ItemDetalhe[]);
          return next;
        });
      }
    } catch {
      // silencioso — expansão mostra fallback vazio
    } finally {
      setItensLoading(null);
    }
  }, [expandedOrderSn, itensCache, shopFilter, shops]);

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
  const pedidosRaw = data?.pedidos ?? [];
  // Filtro client-side por devolução — aplica sobre a página corrente.
  // Nota: o filtro é posterior à paginação da API, então o total da
  // paginação continua refletindo o set pré-filtro.
  const pedidos = useMemo(() => {
    if (filtroDevolucao === 'todos') return pedidosRaw;
    if (filtroDevolucao === 'sem')   return pedidosRaw.filter(p => !p.tem_devolucao);
    return pedidosRaw.filter(p => p.tem_devolucao);
  }, [pedidosRaw, filtroDevolucao]);

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

        <select
          value={filtroDevolucao}
          onChange={e => setFiltroDevolucao(e.target.value as FiltroDevolucao)}
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
        >
          {FILTRO_DEVOLUCAO_OPTIONS.map(f => (
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
          expandedOrderSn={expandedOrderSn}
          onToggleExpand={toggleExpand}
          itensCache={itensCache}
          itensLoading={itensLoading}
          config={config}
        />
      ) : (
        <SkusGrid
          loading={loading}
          skus={skus}
          ordemSkus={ordemSkus}
          onChangeOrdem={setOrdemSkus}
          onOpenDetalhe={s => setSkuDetalhe(s)}
        />
      )}

      {skuDetalhe && (
        <SkuDetalheModal
          sku={skuDetalhe}
          period={period}
          periodLabel={
            PERIOD_OPTIONS.find(p => p.key === period)?.label ?? 'Período'
          }
          shopFilter={shopFilter}
          onClose={() => setSkuDetalhe(null)}
        />
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
  expandedOrderSn, onToggleExpand, itensCache, itensLoading, config,
}: {
  loading: boolean;
  pedidos: Pedido[];
  ordem: Ordem;
  direcao: Direcao;
  onSort: (col: Ordem) => void;
  expandedOrderSn: string | null;
  onToggleExpand: (p: Pedido) => void;
  itensCache: Map<string, ItemDetalhe[]>;
  itensLoading: string | null;
  config: Config;
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
              <th className="px-3 py-2 font-medium w-6" />
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
                    <td colSpan={11} className="px-3 py-3">
                      <div className="h-3 w-full bg-current/5 rounded" />
                    </td>
                  </tr>
                ))}
              </>
            )}
            {!loading && pedidos.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-[11px] opacity-60">
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
              const expanded = expandedOrderSn === p.order_sn;
              return (
                <Fragment key={`${p.order_sn}-${p.data}`}>
                  <tr
                    className="border-t border-current/5 hover:bg-current/[0.04] transition-colors cursor-pointer"
                    style={{ background: bgLucro }}
                    onClick={() => onToggleExpand(p)}
                  >
                    <td className="px-3 py-2 opacity-50 text-center select-none w-6">
                      {expanded ? '▾' : '▸'}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]" title={p.order_sn}>
                      {p.order_sn}
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
                  {expanded && (
                    <tr className="border-t border-current/5">
                      <td colSpan={11} className="px-0 py-0 bg-black/[0.02] dark:bg-white/[0.03]">
                        <PedidoExpandedPanel
                          pedido={p}
                          itens={itensCache.get(p.order_sn)}
                          loadingItens={itensLoading === p.order_sn}
                          config={config}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PedidoExpandedPanel({
  pedido, itens, loadingItens, config,
}: {
  pedido: Pedido;
  itens: ItemDetalhe[] | undefined;
  loadingItens: boolean;
  config: Config;
}) {
  const sign = (v: number) => (v === 0 ? '—' : `−${fmtBRL(v)}`);
  const showAds = config.adsAtivo;
  const showFbs = config.fbsAtivo;

  const lucroColor = pedido.lucro > 0 ? COLORS.verde : pedido.lucro < 0 ? COLORS.vermelho : undefined;

  return (
    <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Breakdown financeiro */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider opacity-60 mb-2">
          Breakdown financeiro
        </h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {pedido.tem_devolucao && <InlineBadge label="Devolução" color={COLORS.vermelho} />}
          {pedido.tem_afiliado && <InlineBadge label="Afiliado" color={COLORS.coral} />}
          {!pedido.tem_cmv && <InlineBadge label="Sem CMV" color={COLORS.cinza} />}
          {pedido.metodo_pagamento && (
            <InlineBadge label={pedido.metodo_pagamento} color={COLORS.azul} />
          )}
        </div>
        <ul className="text-xs space-y-1">
          <BreakdownRow label="Venda" value={fmtBRL(pedido.venda)} />
          <BreakdownRow label="CMV" value={pedido.cmv === 0 ? '—' : `−${fmtBRL(pedido.cmv)}`} neutral={pedido.cmv === 0} />
          <BreakdownRow label="Comissão" value={sign(pedido.comissao)} neutral={pedido.comissao === 0} />
          <BreakdownRow label="Taxa de serviço" value={sign(pedido.taxa_servico)} neutral={pedido.taxa_servico === 0} />
          <BreakdownRow label="Afiliado" value={sign(pedido.afiliado)} neutral={pedido.afiliado === 0} />
          <BreakdownRow label="Cupom seller" value={sign(pedido.cupom_seller)} neutral={pedido.cupom_seller === 0} />
          <BreakdownRow label="Frete devolução" value={sign(pedido.frete_devolucao)} neutral={pedido.frete_devolucao === 0} />
          <BreakdownRow label="DIFAL" value={sign(pedido.difal)} neutral={pedido.difal === 0} />
          {showAds && (
            <BreakdownRow label="Rateio Ads" value={sign(pedido.rateio_ads)} neutral={pedido.rateio_ads === 0} />
          )}
          {showFbs && (
            <BreakdownRow label="Rateio FBS" value={sign(pedido.rateio_fbs)} neutral={pedido.rateio_fbs === 0} />
          )}
          <li className="border-t border-current/10 my-2" />
          <li className="flex items-center justify-between font-medium">
            <span>Lucro</span>
            <span style={{ color: lucroColor }}>{fmtBRL(pedido.lucro)}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Margem</span>
            <MargemBadge margem={pedido.margem_pct} />
          </li>
        </ul>
      </div>

      {/* Itens do pedido */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider opacity-60 mb-2">
          Itens do pedido {itens ? `(${itens.length})` : ''}
        </h3>
        {loadingItens ? (
          <div className="text-[11px] opacity-50">Carregando itens…</div>
        ) : itens === undefined ? (
          <div className="text-[11px] opacity-50">—</div>
        ) : itens.length === 0 ? (
          <div className="text-[11px] opacity-50">
            Itens não encontrados (pedido sem vínculo com Tiny).
          </div>
        ) : (
          <ul className="text-xs space-y-1.5">
            {itens.map((it, i) => (
              <li key={`${it.sku}-${i}`} className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px]">{it.sku}</div>
                  {it.descricao && (
                    <div className="text-[10px] opacity-60 truncate" title={it.descricao}>
                      {it.descricao}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className="text-[11px]">Qtd: <strong>{it.quantidade}</strong></div>
                  <div className="text-[10px] opacity-70">
                    CMV un.: {it.cmv_unitario > 0 ? fmtBRL(it.cmv_unitario) : <span className="opacity-50">—</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, neutral }: { label: string; value: string; neutral?: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className={neutral ? 'opacity-60' : ''}>{label}</span>
      <span className={`tabular-nums ${neutral ? 'opacity-50' : ''}`}>{value}</span>
    </li>
  );
}

function InlineBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ background: `${color}1F`, color }}
    >
      {label}
    </span>
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

function SkusGrid({
  loading, skus, ordemSkus, onChangeOrdem, onOpenDetalhe,
}: {
  loading: boolean;
  skus: SkuRow[];
  ordemSkus: OrdemSkus;
  onChangeOrdem: (o: OrdemSkus) => void;
  onOpenDetalhe: (s: SkuRow) => void;
}) {
  // Ordenação client-side — API retorna por lucro_total desc por padrão.
  const ordenados = useMemo(() => {
    const arr = [...skus];
    switch (ordemSkus) {
      case 'lucro_desc':  return arr.sort((a, b) => b.lucro_total - a.lucro_total);
      case 'lucro_asc':   return arr.sort((a, b) => a.lucro_total - b.lucro_total);
      case 'qtd_desc':    return arr.sort((a, b) => b.qtd_vendida - a.qtd_vendida);
      case 'margem_asc':  return arr.sort((a, b) => a.margem_media - b.margem_media);
    }
  }, [skus, ordemSkus]);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60">
          Detalhamento por SKU pai {skus.length > 0 && <span className="opacity-50">({skus.length})</span>}
        </h2>
        <select
          value={ordemSkus}
          onChange={e => onChangeOrdem(e.target.value as OrdemSkus)}
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
        >
          {ORDEM_SKUS_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>

      {loading && skus.length === 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 rounded-lg animate-pulse h-36">
              <div className="h-4 w-16 bg-current/10 rounded mb-2" />
              <div className="h-3 w-24 bg-current/5 rounded mb-3" />
              <div className="h-3 w-full bg-current/5 rounded mb-1" />
              <div className="h-3 w-full bg-current/5 rounded" />
            </div>
          ))}
        </div>
      ) : ordenados.length === 0 ? (
        <div className="card p-6 rounded-lg text-xs opacity-60 text-center">
          Nenhum SKU encontrado para o período selecionado.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {ordenados.map(s => (
            <SkuCard key={s.sku_pai} sku={s} onClick={() => onOpenDetalhe(s)} />
          ))}
        </div>
      )}
    </div>
  );
}

function skuStatusColor(status: StatusPedido): string {
  switch (status) {
    case 'saudavel': return COLORS.verde;
    case 'atencao':  return COLORS.amber;
    case 'prejuizo': return COLORS.vermelho;
    case 'sem_cmv':  return COLORS.cinza;
  }
}

function SkuCard({ sku, onClick }: { sku: SkuRow; onClick: () => void }) {
  const borderColor = skuStatusColor(sku.status);
  const lucroColor =
    sku.lucro_total > 0 ? COLORS.verde : sku.lucro_total < 0 ? COLORS.vermelho : undefined;
  const margemColor =
    sku.margem_media < 0 ? COLORS.vermelho
    : sku.margem_media < 15 ? COLORS.amber
    : COLORS.verde;
  const negColor = sku.pct_negativos > 10 ? COLORS.vermelho : undefined;

  // Barra visual da margem — centrada em 0, −20% ↔ +40% na escala visível.
  const margemClamp = Math.max(-20, Math.min(40, sku.margem_media));
  const margemRange = 60; // −20 → +40
  const margemFill = ((margemClamp + 20) / margemRange) * 100;

  return (
    <button
      onClick={onClick}
      className="card p-4 rounded-lg text-left transition-colors hover:bg-current/[0.03] relative overflow-hidden"
      style={{ borderLeft: `3px solid ${borderColor}` }}
    >
      <span className="absolute top-2 right-3 opacity-30 group-hover:opacity-60 text-xs">↗</span>

      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[15px] font-medium truncate">SKU {sku.sku_pai}</div>
          <div className="text-[10px] opacity-60 truncate mt-0.5">{sku.descricao || '—'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
        <div>
          <div className="text-[9px] uppercase opacity-50 tracking-wider">Vendas</div>
          <div className="font-medium">{fmtInt(sku.qtd_vendida)} un.</div>
        </div>
        <div>
          <div className="text-[9px] uppercase opacity-50 tracking-wider">Lucro total</div>
          <div className="font-medium" style={lucroColor ? { color: lucroColor } : {}}>
            {fmtBRL(sku.lucro_total)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase opacity-50 tracking-wider">Margem média</div>
          <div className="font-medium" style={{ color: margemColor }}>
            {fmtPct(sku.margem_media)}
          </div>
        </div>
        <div>
          <div className="text-[9px] uppercase opacity-50 tracking-wider">% negativos</div>
          <div className="font-medium" style={negColor ? { color: negColor } : {}}>
            {fmtPct(sku.pct_negativos)}
          </div>
        </div>
      </div>

      {/* Barra de margem */}
      <div className="relative h-1.5 rounded-sm overflow-hidden" style={{ background: 'rgba(128,128,128,0.12)' }}>
        <div
          className="absolute top-0 left-0 h-full"
          style={{ width: `${margemFill}%`, background: margemColor }}
        />
        {/* Linha zero */}
        <div
          className="absolute top-0 bottom-0 w-px"
          style={{ left: `${(20 / margemRange) * 100}%`, background: 'rgba(0,0,0,0.25)' }}
        />
      </div>
    </button>
  );
}

interface SkuDetalheLoja {
  shop_id: number;
  shop_name: string;
  shop_name_curto: string;
  qtd: number;
  receita: number;
  cmv: number;
  lucro: number;
  margem: number;
}
interface SkuDetalheTamanho {
  tamanho: string;
  qtd: number;
  margem: number;
  lucro: number;
}
interface SkuDetalhePior {
  order_sn: string;
  data: string;
  shop_id: number;
  loja: string;
  tamanho: string | null;
  venda: number;
  lucro: number;
  margem: number;
  causa: string;
  tem_devolucao: boolean;
  tem_afiliado: boolean;
  tem_cmv: boolean;
}
interface SkuDetalheResponse {
  sku_pai: string;
  descricao: string | null;
  range: { from: string; to: string };
  cmv_medio: number | null;
  por_loja: SkuDetalheLoja[];
  por_tamanho: SkuDetalheTamanho[];
  piores_pedidos: SkuDetalhePior[];
}

function margemColorFor(m: number): string {
  if (m < 0) return COLORS.vermelho;
  if (m < 15) return COLORS.amber;
  return COLORS.verde;
}

function causaColor(causa: string): string {
  switch (causa) {
    case 'Devolução':     return COLORS.vermelho;
    case 'Sem CMV':       return COLORS.cinza;
    case 'Afiliado alto': return COLORS.coral;
    case 'Comissão alta': return COLORS.amber;
    default:              return COLORS.cinza;
  }
}

function SkuDetalheModal({
  sku, period, periodLabel, shopFilter, onClose,
}: {
  sku: SkuRow;
  period: Period;
  periodLabel: string;
  shopFilter: string;
  onClose: () => void;
}) {
  const [detalhe, setDetalhe] = useState<SkuDetalheResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          sku_pai: sku.sku_pai,
          period,
          shop_id: shopFilter,
        });
        const res = await fetch(`/api/lucro/sku-detalhe?${params.toString()}`, { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && res.ok) setDetalhe(json as SkuDetalheResponse);
      } catch {
        if (!cancelled) setDetalhe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sku.sku_pai, period, shopFilter]);

  const lucroColor = sku.lucro_total > 0 ? COLORS.verde : sku.lucro_total < 0 ? COLORS.vermelho : undefined;
  // CMV médio agora vem do endpoint (ponderado por faixa/tamanho via sku_custo).
  // Antes do fetch resolver, cai num fallback neutro.
  const cmvMedio = detalhe?.cmv_medio ?? null;
  const semCmv = !loading && detalhe != null && cmvMedio == null;

  const descricaoReal = detalhe?.descricao ?? null;
  const periodoStr = detalhe?.range
    ? `${fmtDateBR(detalhe.range.from)} a ${fmtDateBR(detalhe.range.to)}`
    : periodLabel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-lg w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 pb-3 border-b border-current/10 shrink-0 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-medium truncate" style={{ fontSize: '18px' }}>
              SKU {sku.sku_pai}
              {descricaoReal && (
                <span className="opacity-60"> — {descricaoReal}</span>
              )}
            </h3>
            <p className="text-[12px] opacity-60 mt-0.5">
              {fmtInt(sku.qtd_vendida)} vendas · Período: {periodoStr}
            </p>
          </div>
          <button onClick={onClose} className="text-xl opacity-50 hover:opacity-100 leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-5">
          {/* KPIs mini */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniKpi label="Lucro total" value={fmtBRL(sku.lucro_total)} color={lucroColor} />
            <MiniKpi
              label="Margem média"
              value={fmtPct(sku.margem_media)}
              color={margemColorFor(sku.margem_media)}
            />
            <MiniKpi
              label="CMV médio"
              value={
                loading
                  ? '—'
                  : semCmv
                    ? 'Sem CMV'
                    : cmvMedio != null
                      ? fmtBRL(cmvMedio)
                      : '—'
              }
              color={semCmv ? COLORS.cinza : undefined}
            />
            <MiniKpi
              label="% negativos"
              value={fmtPct(sku.pct_negativos)}
              color={sku.pct_negativos > 10 ? COLORS.vermelho : undefined}
            />
          </div>

          {loading ? (
            <div className="text-[11px] opacity-50">Carregando detalhes…</div>
          ) : !detalhe ? (
            <div className="text-[11px] opacity-50">Falha ao carregar detalhes.</div>
          ) : (
            <>
              {/* Seção 1: Lucro por loja */}
              <div>
                <h4 className="text-[11px] uppercase tracking-wider opacity-60 mb-2">
                  Lucro por loja
                </h4>
                {detalhe.por_loja.length === 0 ? (
                  <div className="text-[11px] opacity-50">—</div>
                ) : (
                  <ul>
                    {detalhe.por_loja.map(l => (
                      <li
                        key={l.shop_id}
                        className="flex items-center justify-between py-2 text-xs"
                        style={{ borderBottom: '0.5px solid rgba(128,128,128,0.2)' }}
                      >
                        <span className="truncate pr-2">{l.shop_name_curto}</span>
                        <span
                          className="tabular-nums whitespace-nowrap"
                          style={{ color: l.lucro > 0 ? COLORS.verde : l.lucro < 0 ? COLORS.vermelho : undefined }}
                        >
                          {fmtBRL(l.lucro)} · {fmtPct(l.margem)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Seção 2: Margem por tamanho */}
              <div>
                <h4 className="text-[11px] uppercase tracking-wider opacity-60 mb-2">
                  Margem por tamanho
                </h4>
                {detalhe.por_tamanho.length === 0 ? (
                  <div className="text-[11px] opacity-50">—</div>
                ) : (
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))' }}>
                    {detalhe.por_tamanho.map(t => (
                      <div
                        key={t.tamanho}
                        className="rounded p-2"
                        style={{ background: 'rgba(128,128,128,0.08)' }}
                      >
                        <div className="text-[11px] opacity-50">{t.tamanho}</div>
                        <div
                          className="font-medium"
                          style={{ fontSize: '14px', color: margemColorFor(t.margem) }}
                        >
                          {fmtPct(t.margem)}
                        </div>
                        <div className="text-[10px] opacity-50 mt-0.5">{fmtInt(t.qtd)} ped.</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Seção 3: Piores pedidos deste SKU */}
              <div>
                <h4 className="text-[11px] uppercase tracking-wider opacity-60 mb-2">
                  Piores pedidos deste SKU
                </h4>
                {detalhe.piores_pedidos.length === 0 ? (
                  <div className="text-[11px] opacity-50">Nenhum pedido encontrado no período.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left opacity-50 border-b border-current/10">
                          <th className="px-2 py-1.5 font-medium">Pedido</th>
                          <th className="px-2 py-1.5 font-medium">Loja</th>
                          <th className="px-2 py-1.5 font-medium">Tamanho</th>
                          <th className="px-2 py-1.5 font-medium text-right">Venda</th>
                          <th className="px-2 py-1.5 font-medium text-right">Lucro</th>
                          <th className="px-2 py-1.5 font-medium">Causa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalhe.piores_pedidos.map(p => (
                          <tr key={p.order_sn} className="border-t border-current/5">
                            <td className="px-2 py-1.5 font-mono text-[11px]">{p.order_sn}</td>
                            <td className="px-2 py-1.5 opacity-80 truncate max-w-[140px]" title={p.loja}>
                              {p.loja}
                            </td>
                            <td className="px-2 py-1.5 opacity-80">{p.tamanho ?? '—'}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtBRL(p.venda)}</td>
                            <td
                              className="px-2 py-1.5 text-right font-medium tabular-nums"
                              style={{ color: p.lucro > 0 ? COLORS.verde : p.lucro < 0 ? COLORS.vermelho : undefined }}
                            >
                              {fmtBRL(p.lucro)}
                            </td>
                            <td className="px-2 py-1.5">
                              <InlineBadge label={p.causa} color={causaColor(p.causa)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-current/10 shrink-0 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

function MiniKpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="card-secondary p-3 rounded-md">
      <div className="text-[9px] uppercase tracking-wider opacity-50 mb-0.5">{label}</div>
      <div className="text-sm font-medium" style={color ? { color } : {}}>{value}</div>
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
