'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

type PeriodKey = 'today' | 'yesterday' | '7d' | '15d' | 'month' | 'last_month' | 'custom';

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '15d', label: '15 dias' },
  { key: 'month', label: 'Mês atual' },
  { key: 'last_month', label: 'Mês anterior' },
  { key: 'custom', label: 'Personalizado' },
];

interface ApiResponse {
  period: { from: string; to: string; label: string };
  shops: Array<{ shop_id: number; name: string | null }>;
  shop_filter: string;
  receita: {
    gmv: number;
    gmv_variacao: number;
    receita_liquida: number;
    receita_liquida_pct: number;
    receita_liquida_variacao: number;
    ticket_medio: number;
    preco_medio_efetivo: number;
    total_pedidos: number;
    total_pecas: number;
  };
  take_rate: { percentual: number; valor: number };
  custos: {
    plataforma: {
      total: number; pct_gmv: number;
      comissao: number; comissao_pct: number;
      taxa_servico: number; taxa_servico_pct: number;
      taxa_transacao: number; taxa_cartao: number;
      fbs_fee: number; processing_fee: number;
    };
    aquisicao: {
      total: number; pct_gmv: number;
      ads: number; ads_roas: number; ads_tacos: number;
      afiliados: number; afiliados_pct: number;
    };
    friccao: {
      total: number; pct_gmv: number;
      devolucoes: {
        custo_total: number;
        frete_reverso: number;
        frete_ida_seller: number;
        total_wallet: number;
        reversao_receita: number;
        qtd: number;
      };
      difal: number; difal_qtd: number;
      pedidos_negativos: number; pedidos_negativos_qtd: number;
      fbs_custos: number; outros: number;
    };
    total: number; total_pct_gmv: number;
  };
  margem: { valor: number; pct_gmv: number };
  subsidio_shopee: {
    total: number; desconto_shopee: number; voucher_shopee: number;
    coins: number; promo_cartao: number; pix_discount: number;
    pct_gmv: number;
  };
  compensacoes: {
    total: number;
    qtd: number;
    detalhe: Array<{ description: string; count: number; total: number }>;
  };
  informativo: {
    saques: number; saques_qtd: number; saldo_carteira: number;
    cobertura_financeira: number; pedidos_sem_escrow: number;
    receita_pendente: number;
    detail_coverage: number;
    escrows_com_detail: number;
    escrows_sem_detail: number;
  };
  cupons_seller: { voucher_seller: number; seller_discount: number };
  outros_custos_detalhe: Array<{
    transaction_type: string; description: string; classificacao: string;
    count: number; total: number;
  }>;
  receita_por_dia: Array<{ date: string; gmv: number; liquido: number; ads: number; custos_plataforma: number }>;
  distribuicao: {
    liquido_pct: number; plataforma_pct: number; ads_pct: number;
    afiliados_pct: number; difal_pct: number; devolucoes_frete_pct: number; outros_pct: number;
  };
  conciliacao: Record<string, number>;
  ultimos_pedidos: Array<{
    order_sn: string;
    buyer_total_amount: number | null;
    commission_fee: number | null;
    service_fee: number | null;
    escrow_amount: number | null;
    buyer_payment_method: string | null;
    is_released: boolean;
    order_status: string | null;
    reverse_shipping_fee: number | null;
    order_ams_commission_fee: number | null;
  }>;
}

const COLORS = {
  azul: '#378ADD',
  verde: '#1D9E75',
  vermelho: '#E24B4A',
  vermelhoEscuro: '#A32D2D',
  amber: '#EF9F27',
  roxo: '#7F77DD',
  cinza: '#888780',
  coral: '#D85A30',
  rosa: '#D4537E',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return BRL.format(n);
}
function fmtBRLCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `R$ ${(n / 1000).toFixed(1)}k`;
  return BRL.format(n);
}
function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}%`;
}
function fmtInt(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.substring(2)}`;
}

function Delta({ variacao }: { variacao: number }) {
  const positivo = variacao >= 0;
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
        positivo ? 'text-[#1D9E75] bg-[#1D9E75]/10' : 'text-[#E24B4A] bg-[#E24B4A]/10'
      }`}
    >
      {positivo ? '▲' : '▼'} {Math.abs(variacao).toFixed(1)}%
    </span>
  );
}

function MetricCard({
  label, value, delta, sub, valueColor, highlight,
}: {
  label: string;
  value: string;
  delta?: number;
  sub?: React.ReactNode;
  valueColor?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`card p-4 rounded-lg ${highlight ? 'border border-current/10' : ''}`}
    >
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`font-medium ${highlight ? 'text-xl' : 'text-lg'}`}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </span>
        {delta !== undefined && <Delta variacao={delta} />}
      </div>
      {sub && <div className="text-[10px] opacity-60">{sub}</div>}
    </div>
  );
}

function Skeleton4() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="card p-4 rounded-lg animate-pulse">
          <div className="h-12 bg-current/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-4">{children}</h2>
  );
}

const CONCILIACAO_DISPLAY: Array<{ key: string; label: string; bg: string; color: string }> = [
  { key: 'PAGO_OK', label: 'Pago OK', bg: 'rgba(29,158,117,0.12)', color: '#1D9E75' },
  { key: 'AGUARDANDO_ENVIO', label: 'Aguardando envio', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'EM_TRANSITO', label: 'Em trânsito', bg: 'rgba(239,159,39,0.14)', color: '#B4760F' },
  { key: 'ENTREGUE_AGUARDANDO_CONFIRMACAO', label: 'Entregue (aguardando)', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'AGUARDANDO_LIBERACAO', label: 'Aguardando liberação', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'PAGO_COM_DIVERGENCIA', label: 'Pago c/ divergência', bg: 'rgba(234,179,8,0.14)', color: '#a16207' },
  { key: 'DEVOLVIDO', label: 'Devolvido', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'REEMBOLSADO_PARCIAL', label: 'Reembolsado parcial', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'EM_DISPUTA', label: 'Em disputa', bg: 'rgba(234,179,8,0.14)', color: '#a16207' },
  { key: 'ATRASO_DE_REPASSE', label: 'Atraso de repasse', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'CANCELADO', label: 'Cancelado', bg: 'rgba(156,163,175,0.14)', color: '#4b5563' },
  { key: 'DADOS_INSUFICIENTES', label: 'Dados insuficientes', bg: 'rgba(156,163,175,0.14)', color: '#4b5563' },
  { key: 'SEM_VINCULO_FINANCEIRO', label: 'Sem vínculo', bg: 'rgba(163,45,45,0.15)', color: '#A32D2D' },
  { key: 'ORFAO_SHOPEE', label: 'Órfão Shopee', bg: 'rgba(163,45,45,0.15)', color: '#A32D2D' },
];

const CLASSIFICACAO_BADGES: Record<string, { bg: string; color: string; label: string }> = {
  receita: { bg: 'rgba(29,158,117,0.12)', color: '#16764f', label: 'Receita' },
  custo_plataforma: { bg: 'rgba(226,75,74,0.12)', color: '#A32D2D', label: 'Plataforma' },
  custo_aquisicao: { bg: 'rgba(127,119,221,0.14)', color: '#4B44A1', label: 'Aquisição' },
  custo_friccao: { bg: 'rgba(216,90,48,0.14)', color: '#8B3910', label: 'Fricção' },
  informativo: { bg: 'rgba(55,138,221,0.12)', color: '#1F5FA5', label: 'Informativo' },
  ignorar: { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Ignorar' },
};

function paymentBadge(method: string | null): { bg: string; color: string; label: string } {
  const m = (method ?? '').toLowerCase();
  if (m.includes('pix')) return { bg: 'rgba(29,158,117,0.12)', color: '#1D9E75', label: 'Pix' };
  if (m.includes('parcela') || m.includes('installment') || m.includes('sparcel'))
    return { bg: 'rgba(55,138,221,0.12)', color: '#378ADD', label: 'SParcelado' };
  if (m.includes('card') || m.includes('cart'))
    return { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Cartão' };
  return { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: method ?? '—' };
}

export default function FinanceiroShopeePage() {
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [shopFilter, setShopFilter] = useState<string>('all');
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [outrosOpen, setOutrosOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (period === 'custom' && (!customFrom || !customTo)) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, shop_id: shopFilter });
      if (period === 'custom') {
        params.set('from', customFrom);
        params.set('to', customTo);
      }
      const res = await fetch(`/api/shopee/financeiro?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      setData(json);
      setLastUpdate(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo, shopFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ============== CHART DATA ==============
  const barData = useMemo(() => {
    if (!data) return null;
    const labels = data.receita_por_dia.map(d => fmtDateShort(d.date));
    return {
      labels,
      datasets: [
        { label: 'GMV', data: data.receita_por_dia.map(d => d.gmv), backgroundColor: COLORS.azul, borderRadius: 3, barPercentage: 0.7 },
        { label: 'Líquido', data: data.receita_por_dia.map(d => d.liquido), backgroundColor: COLORS.verde, borderRadius: 3, barPercentage: 0.7 },
        { label: 'Ads', data: data.receita_por_dia.map(d => d.ads), backgroundColor: COLORS.vermelho, borderRadius: 3, barPercentage: 0.7 },
      ],
    };
  }, [data]);

  const barOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label: (ctx: any) => `${ctx.dataset?.label ?? ''}: ${fmtBRLCompact(ctx.parsed?.y ?? 0)}`,
        },
      },
    },
    scales: {
      y: {
        ticks: { callback: (v: string | number) => fmtBRLCompact(Number(v)), font: { size: 9 }, color: '#9ca3af' },
        grid: { color: 'rgba(128,128,128,0.08)' },
      },
      x: {
        ticks: { font: { size: 9 }, color: '#9ca3af', maxRotation: 0 },
        grid: { display: false },
      },
    },
  }), []);

  const donutData = useMemo(() => {
    if (!data) return null;
    const d = data.distribuicao;
    return {
      labels: ['Líquido', 'Plataforma', 'Ads', 'Afiliados', 'DIFAL', 'Devoluções (frete)', 'Outros'],
      datasets: [{
        data: [
          Math.max(0, d.liquido_pct),
          d.plataforma_pct, d.ads_pct, d.afiliados_pct,
          d.difal_pct, d.devolucoes_frete_pct, d.outros_pct,
        ],
        backgroundColor: [
          COLORS.verde, COLORS.vermelho, COLORS.azul, COLORS.roxo,
          COLORS.coral, COLORS.rosa, COLORS.cinza,
        ],
        borderWidth: 0,
      }],
    };
  }, [data]);

  const donutOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label: (ctx: any) => `${ctx.label ?? ''}: ${(ctx.parsed ?? 0).toFixed(1)}%`,
        },
      },
    },
  }), []);

  // ================== RENDER ==================
  const r = data?.receita;
  const tr = data?.take_rate;
  const cp = data?.custos.plataforma;
  const ca = data?.custos.aquisicao;
  const cf = data?.custos.friccao;
  const ct = data?.custos;
  const mg = data?.margem;
  const sb = data?.subsidio_shopee;
  const info = data?.informativo;

  const coberturaColor = info
    ? info.cobertura_financeira >= 90
      ? COLORS.verde
      : info.cobertura_financeira >= 70
        ? COLORS.amber
        : COLORS.vermelho
    : undefined;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Financeiro Shopee</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Atualizado às {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {data && ` · Período: ${fmtDateBR(data.period.from)} a ${fmtDateBR(data.period.to)}`}
        </p>
      </div>

      {/* Filtros */}
      <div className="card p-3 rounded-lg mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {PERIOD_OPTIONS.map(p => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                period === p.key
                  ? 'bg-[#378ADD] text-white'
                  : 'hover:bg-black/5 dark:hover:bg-white/5 text-current opacity-70'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
            />
            <span className="opacity-50">→</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
            />
          </div>
        )}

        <div className="flex-1" />

        <select
          value={shopFilter}
          onChange={e => setShopFilter(e.target.value)}
          className="px-2 py-1 rounded border border-current/15 bg-transparent text-xs"
        >
          <option value="all">Todas as lojas</option>
          {data?.shops.map(s => (
            <option key={s.shop_id} value={s.shop_id}>
              {s.name || `Shop ${s.shop_id}`}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="card p-3 rounded-lg mb-4 text-xs" style={{ color: COLORS.vermelho }}>
          Erro: {error}
        </div>
      )}

      {/* ============ SEÇÃO 1: RECEITA ============ */}
      <SectionLabel>Receita</SectionLabel>
      {loading || !r ? <Skeleton4 /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="GMV (Faturamento bruto)"
            value={fmtBRL(r.gmv)}
            delta={r.gmv_variacao}
            sub={
              r.gmv < r.receita_liquida && info
                ? `Baseado em ${fmtInt(info.escrows_com_detail)} pedidos com detail completo`
                : `${fmtInt(r.total_pedidos)} pedidos com escrow`
            }
          />
          <MetricCard
            label="Receita líquida"
            value={fmtBRL(r.receita_liquida)}
            valueColor={COLORS.verde}
            delta={r.receita_liquida_variacao}
            sub={`${fmtPct(r.receita_liquida_pct)} do GMV`}
          />
          <MetricCard
            label="Ticket médio"
            value={fmtBRL(r.ticket_medio)}
            sub={`Preço efetivo: ${fmtBRL(r.preco_medio_efetivo)}`}
          />
          <MetricCard
            label="Cobertura financeira"
            value={fmtPct(info?.cobertura_financeira ?? 0)}
            valueColor={coberturaColor}
            sub={info && info.pedidos_sem_escrow > 0
              ? `${fmtInt(info.pedidos_sem_escrow)} pedidos sem escrow (total histórico)`
              : 'Todos os pedidos com escrow (total histórico)'}
          />
        </div>
      )}

      {/* ============ SEÇÃO 2: CUSTOS PLATAFORMA ============ */}
      <SectionLabel>Custos — Plataforma</SectionLabel>
      {!loading && info && info.detail_coverage < 80 && info.escrows_com_detail + info.escrows_sem_detail > 0 && (
        <div
          className="rounded-lg px-3 py-2 mb-2 text-[11px]"
          style={{ background: 'rgba(239,159,39,0.12)', color: '#8B5F0A' }}
        >
          Percentuais abaixo são baseados em <strong>{fmtInt(info.escrows_com_detail)}</strong> pedidos com detail completo
          ({fmtPct(info.detail_coverage)} do período). Outros{' '}
          <strong>{fmtInt(info.escrows_sem_detail)}</strong> ainda aguardam o fetch do escrow_detail —
          GMV/Líquido usam fallback via <code>payout_amount</code>.
        </div>
      )}
      {loading || !cp || !tr ? <Skeleton4 /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Take rate"
            value={fmtPct(tr.percentual)}
            valueColor={COLORS.vermelho}
            sub={`Shopee fica ${fmtBRL(tr.valor)}`}
          />
          <MetricCard
            label="Comissão"
            value={fmtBRL(cp.comissao)}
            valueColor={COLORS.vermelho}
            sub={`${fmtPct(cp.comissao_pct)} do GMV`}
          />
          <MetricCard
            label="Taxa de serviço"
            value={fmtBRL(cp.taxa_servico)}
            valueColor={COLORS.vermelho}
            sub={`${fmtPct(cp.taxa_servico_pct)} do GMV`}
          />
          {cp.taxa_transacao + cp.taxa_cartao + cp.fbs_fee + cp.processing_fee > 0 ? (
            <MetricCard
              label="Outros plataforma"
              value={fmtBRL(cp.taxa_transacao + cp.taxa_cartao + cp.fbs_fee + cp.processing_fee)}
              valueColor={COLORS.vermelho}
              sub="Cartão + FBS + transação + processing"
            />
          ) : (
            <MetricCard
              label="Total plataforma"
              value={fmtBRL(cp.total)}
              valueColor={COLORS.vermelho}
              sub={`${fmtPct(cp.pct_gmv)} do GMV`}
            />
          )}
        </div>
      )}

      {/* ============ SEÇÃO 3: CUSTOS AQUISIÇÃO ============ */}
      <SectionLabel>Custos — Aquisição</SectionLabel>
      {loading || !ca ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {[1,2,3].map(i => (
            <div key={i} className="card p-4 rounded-lg animate-pulse"><div className="h-12 bg-current/5 rounded" /></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <MetricCard
            label="Gastos com Ads"
            value={fmtBRL(ca.ads)}
            valueColor={COLORS.amber}
            sub={ca.ads_roas > 0 ? `ROAS ${ca.ads_roas.toFixed(2)}x` : 'Sem retorno apurado'}
          />
          <MetricCard
            label="TACOS"
            value={fmtPct(ca.ads_tacos)}
            valueColor={COLORS.amber}
            sub="% do GMV em Ads"
          />
          <MetricCard
            label="Gastos com afiliados"
            value={fmtBRL(ca.afiliados)}
            valueColor={COLORS.roxo}
            sub={`${fmtPct(ca.afiliados_pct)} do GMV`}
          />
        </div>
      )}

      {/* ============ SEÇÃO 4: CUSTOS FRICÇÃO ============ */}
      <SectionLabel>Custos — Fricção operacional</SectionLabel>
      {loading || !cf ? <Skeleton4 /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <MetricCard
              label="Devoluções"
              value={fmtBRL(cf.devolucoes.custo_total)}
              valueColor={COLORS.vermelho}
              sub={(
                <>
                  Frete reverso: <strong>{fmtBRL(cf.devolucoes.frete_reverso)}</strong>
                  {' · '}Frete ida: <strong>{fmtBRL(cf.devolucoes.frete_ida_seller)}</strong>
                  {' · '}{fmtInt(cf.devolucoes.qtd)} devoluções
                </>
              )}
            />
            <MetricCard
              label="DIFAL (ICMS)"
              value={fmtBRL(cf.difal)}
              valueColor={COLORS.vermelho}
              sub={`${fmtInt(cf.difal_qtd)} cobranças`}
            />
            <MetricCard
              label="Pedidos negativos"
              value={fmtBRL(cf.pedidos_negativos)}
              valueColor={COLORS.cinza}
              sub={`${fmtInt(cf.pedidos_negativos_qtd)} pedidos · Informativo — custo já contabilizado em devoluções`}
            />
            <div className="card p-4 rounded-lg">
              <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">Outros custos</p>
              <span className="text-lg font-medium" style={{ color: COLORS.vermelho }}>
                {fmtBRL(cf.outros + cf.fbs_custos)}
              </span>
              <button
                onClick={() => setOutrosOpen(v => !v)}
                className="block mt-1 text-[10px] text-[#378ADD] hover:underline"
              >
                {outrosOpen ? 'Ocultar detalhes' : 'Ver detalhes >'}
              </button>
            </div>
          </div>

          {outrosOpen && data && (
            <div className="card p-4 rounded-lg mb-4">
              <h3 className="text-xs font-medium opacity-70 mb-3">Detalhamento de outros custos</h3>
              {data.outros_custos_detalhe.length === 0 ? (
                <p className="text-xs opacity-40">Nenhum custo classificado como &quot;outros&quot; no período.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left opacity-50">
                          <th className="pb-2">Tipo</th>
                          <th className="pb-2">Descrição</th>
                          <th className="pb-2">Classificação</th>
                          <th className="pb-2 text-right">Qtd</th>
                          <th className="pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.outros_custos_detalhe.map((o, i) => {
                          const badge = CLASSIFICACAO_BADGES[o.classificacao] ?? CLASSIFICACAO_BADGES.ignorar;
                          return (
                            <tr key={`${o.transaction_type}-${i}`} className="border-t border-current/5">
                              <td className="py-1.5 font-mono text-[10px]">{o.transaction_type}</td>
                              <td className="py-1.5 max-w-[380px] truncate" title={o.description}>
                                {o.description || '—'}
                              </td>
                              <td className="py-1.5">
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                  style={{ background: badge.bg, color: badge.color }}
                                >
                                  {badge.label}
                                </span>
                              </td>
                              <td className="py-1.5 text-right">{fmtInt(o.count)}</td>
                              <td
                                className="py-1.5 text-right"
                                style={{ color: o.total < 0 ? COLORS.vermelho : COLORS.verde }}
                              >
                                {fmtBRL(o.total)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] opacity-40 mt-3">
                    Transações não classificadas aparecem aqui. Para mapear, adicione uma linha em <code>shopee_transaction_mapping</code>.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ============ COMPENSAÇÕES ============ */}
      {!loading && data && data.compensacoes.total > 0 && (() => {
        // Buckets por description. "perdido" tem prioridade — se casar ali,
        // não cai em "compensation/return" mesmo que case também.
        const isPerdido = (d: string) => /perdido/i.test(d);
        const isDevolucao = (d: string) => /(compensation|return)/i.test(d);
        const perdidos = data.compensacoes.detalhe.filter(d => isPerdido(d.description));
        const devolucoes = data.compensacoes.detalhe.filter(
          d => !isPerdido(d.description) && isDevolucao(d.description),
        );
        const outros = data.compensacoes.detalhe.filter(
          d => !isPerdido(d.description) && !isDevolucao(d.description),
        );
        const agg = (items: typeof data.compensacoes.detalhe) => ({
          total: items.reduce((s, i) => s + i.total, 0),
          count: items.reduce((s, i) => s + i.count, 0),
        });
        const gPerdidos = agg(perdidos);
        const gDevolucoes = agg(devolucoes);
        const gOutros = agg(outros);

        return (
          <>
            <SectionLabel>Compensações Shopee</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard
                label="Total Compensações"
                value={fmtBRL(data.compensacoes.total)}
                valueColor={COLORS.verde}
                sub={`${fmtInt(data.compensacoes.qtd)} reembolsos recebidos`}
              />
              <MetricCard
                label="Objetos perdidos"
                value={fmtBRL(gPerdidos.total)}
                valueColor={COLORS.verde}
                sub={`${fmtInt(gPerdidos.count)} reembolsos`}
              />
              <MetricCard
                label="Devoluções compensadas"
                value={fmtBRL(gDevolucoes.total)}
                valueColor={COLORS.verde}
                sub={`${fmtInt(gDevolucoes.count)} reembolsos`}
              />
              <MetricCard
                label="Outras compensações"
                value={fmtBRL(gOutros.total)}
                valueColor={COLORS.verde}
                sub="Outros tipos de reembolso"
              />
            </div>
          </>
        );
      })()}

      {/* ============ SEÇÃO 5: RESULTADO ============ */}
      <SectionLabel>Resultado do período</SectionLabel>
      {loading || !ct || !mg || !sb || !info ? <Skeleton4 /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard
            highlight
            label="Custo total Shopee"
            value={fmtBRL(ct.total)}
            valueColor={COLORS.vermelho}
            sub={`${fmtPct(ct.total_pct_gmv)} do GMV`}
          />
          <MetricCard
            highlight
            label="Margem operacional"
            value={fmtBRL(mg.valor)}
            valueColor={mg.valor >= 0 ? COLORS.verde : COLORS.vermelho}
            sub={`${fmtPct(mg.pct_gmv)} do GMV`}
          />
          <MetricCard
            highlight
            label="Subsídio Shopee"
            value={fmtBRL(sb.total)}
            valueColor={COLORS.verde}
            sub={`${fmtPct(sb.pct_gmv)} do GMV — dependência`}
          />
          <MetricCard
            highlight
            label="Saques"
            value={fmtBRL(info.saques)}
            valueColor={COLORS.azul}
            sub={`${fmtInt(info.saques_qtd)} transferências para conta PJ`}
          />
        </div>
      )}

      {/* ============ INFORMATIVO (global, não filtrado) ============ */}
      {!loading && info && (
        <>
          <SectionLabel>Informativo (global)</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <MetricCard
              label="Receita pendente"
              value={fmtBRL(info.receita_pendente)}
              valueColor={COLORS.amber}
              sub="Escrow ainda não liberado — dinheiro a caminho da carteira"
            />
            <MetricCard
              label="Saldo atual da carteira"
              value={fmtBRL(info.saldo_carteira)}
              valueColor={COLORS.azul}
              sub="Último current_balance sincronizado"
            />
          </div>
        </>
      )}

      {/* ============ SEÇÃO 6: GRÁFICOS ============ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <div className="card p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium opacity-70">Receita por dia</h3>
            <div className="flex gap-3 text-[10px] opacity-70">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: COLORS.azul }} /> GMV
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: COLORS.verde }} /> Líquido
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ background: COLORS.vermelho }} /> Ads
              </span>
            </div>
          </div>
          <div style={{ height: 220 }}>
            {loading || !barData ? (
              <div className="h-full bg-current/5 rounded animate-pulse" />
            ) : (
              <Bar data={barData} options={barOptions} />
            )}
          </div>
        </div>

        <div className="card p-4 rounded-lg">
          <h3 className="text-xs font-medium opacity-70 mb-3">Distribuição do resultado do período</h3>
          <div style={{ height: 180 }}>
            {loading || !donutData ? (
              <div className="h-full bg-current/5 rounded animate-pulse" />
            ) : (
              <Doughnut data={donutData} options={donutOptions} />
            )}
          </div>
          {data && donutData && (
            <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
              {donutData.labels.map((lbl, idx) => (
                <span key={lbl} className="flex items-center gap-1 opacity-80">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: (donutData.datasets[0].backgroundColor as string[])[idx] }}
                  />
                  {lbl} {(donutData.datasets[0].data[idx] as number).toFixed(1)}%
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ SEÇÃO 7: CONCILIAÇÃO ============ */}
      <SectionLabel>Status da conciliação</SectionLabel>
      <div className="card p-4 rounded-lg mb-4">
        {loading || !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="p-3 rounded animate-pulse bg-current/5" style={{ height: 60 }} />
            ))}
          </div>
        ) : (() => {
          const visible = CONCILIACAO_DISPLAY.filter(c => (data.conciliacao[c.key] ?? 0) > 0);
          if (visible.length === 0) {
            return <p className="text-xs opacity-40">Nenhum pedido conciliado ainda.</p>;
          }
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {visible.map(c => (
                <div
                  key={c.key}
                  className="p-3 rounded-lg"
                  style={{ background: c.bg }}
                >
                  <p className="text-[10px] font-medium" style={{ color: c.color }}>{c.label}</p>
                  <p className="text-lg font-semibold" style={{ color: c.color }}>
                    {fmtInt(data.conciliacao[c.key])}
                  </p>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* ============ SEÇÃO 8: ÚLTIMOS PEDIDOS ============ */}
      <SectionLabel>Últimos pedidos com escrow</SectionLabel>
      <div className="card p-4 rounded-lg">
        {loading || !data ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-6 bg-current/5 rounded animate-pulse" />
            ))}
          </div>
        ) : data.ultimos_pedidos.length === 0 ? (
          <p className="text-xs opacity-40">Nenhum pedido com escrow ainda.</p>
        ) : (() => {
          const showAfiliado = data.ultimos_pedidos.some(p => (p.order_ams_commission_fee ?? 0) > 0);
          const showFreteDev = data.ultimos_pedidos.some(p => (p.reverse_shipping_fee ?? 0) > 0);
          return (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left opacity-50">
                    <th className="pb-2">Pedido</th>
                    <th className="pb-2 text-right">GMV</th>
                    <th className="pb-2 text-right">Comissão</th>
                    <th className="pb-2 text-right">Taxa</th>
                    <th className="pb-2 text-right">Líquido</th>
                    {showAfiliado && <th className="pb-2 text-right">Afiliado</th>}
                    {showFreteDev && <th className="pb-2 text-right">Frete dev.</th>}
                    <th className="pb-2">Pgto</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimos_pedidos.map(p => {
                    const pb = paymentBadge(p.buyer_payment_method);
                    const liquidoCor = (p.escrow_amount ?? 0) >= 0 ? COLORS.verde : COLORS.vermelho;
                    return (
                      <tr key={p.order_sn} className="border-t border-current/5">
                        <td className="py-1.5 font-mono text-[10px]">{p.order_sn}</td>
                        <td className="py-1.5 text-right">{fmtBRL(p.buyer_total_amount)}</td>
                        <td className="py-1.5 text-right" style={{ color: COLORS.vermelho }}>
                          {fmtBRL(p.commission_fee)}
                        </td>
                        <td className="py-1.5 text-right" style={{ color: COLORS.vermelho }}>
                          {fmtBRL(p.service_fee)}
                        </td>
                        <td className="py-1.5 text-right" style={{ color: liquidoCor }}>
                          {fmtBRL(p.escrow_amount)}
                        </td>
                        {showAfiliado && (
                          <td className="py-1.5 text-right" style={{ color: COLORS.roxo }}>
                            {(p.order_ams_commission_fee ?? 0) > 0
                              ? fmtBRL(p.order_ams_commission_fee)
                              : '—'}
                          </td>
                        )}
                        {showFreteDev && (
                          <td className="py-1.5 text-right" style={{ color: COLORS.vermelho }}>
                            {(p.reverse_shipping_fee ?? 0) > 0
                              ? fmtBRL(p.reverse_shipping_fee)
                              : '—'}
                          </td>
                        )}
                        <td className="py-1.5">
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ background: pb.bg, color: pb.color }}
                          >
                            {pb.label}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={
                              p.is_released
                                ? { background: 'rgba(29,158,117,0.12)', color: COLORS.verde }
                                : { background: 'rgba(239,159,39,0.14)', color: COLORS.amber }
                            }
                          >
                            {p.is_released ? 'Liberado' : 'Pendente'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
