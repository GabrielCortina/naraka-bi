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
  kpis: {
    faturamento_bruto: number;
    faturamento_bruto_variacao: number;
    valor_liquido: number;
    valor_liquido_pct: number;
    comissao_media_pct: number;
    comissao_media_valor: number;
    custo_total_shopee_pct: number;
    comissao_total: number;
    comissao_pct: number;
    taxa_servico_total: number;
    taxa_servico_pct: number;
    ads_total: number;
    ads_roas: number;
    afiliados_total: number;
    afiliados_pct: number;
    rebate_shopee: number;
    devolucoes_frete: number;
    devolucoes_qtd: number;
    saques_total: number;
    outros_custos: number;
  };
  outros_custos_detalhe: Array<{
    transaction_type: string;
    description: string;
    count: number;
    total: number;
    categoria: string;
  }>;
  receita_por_dia: Array<{ date: string; bruto: number; liquido: number; ads: number }>;
  breakdown_custos: {
    liquido_pct: number;
    comissao_pct: number;
    taxa_pct: number;
    ads_pct: number;
    afiliados_pct: number;
    devolucoes_pct: number;
    outros_pct: number;
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
  }>;
}

// Paleta — cor de cada categoria, reutilizada em cards + donut
const COLORS = {
  azul: '#378ADD',
  verde: '#1D9E75',
  vermelho: '#E24B4A',
  amber: '#EF9F27',
  roxo: '#8B5CF6',
  cinza: '#9CA3AF',
  vermelhoClaro: '#F59191',
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
function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

// Small delta badge — mesma linguagem do KpisHero do Dashboard
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
  label, value, delta, sub, valueColor, subColor,
}: {
  label: string;
  value: string;
  delta?: number;
  sub?: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div className="card p-4 rounded-lg">
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="text-lg font-medium"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value}
        </span>
        {delta !== undefined && <Delta variacao={delta} />}
      </div>
      {sub && (
        <p className="text-[10px]" style={{ color: subColor ?? 'var(--txt3)' }}>
          {sub}
        </p>
      )}
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

const CONCILIACAO_DISPLAY: Array<{ key: string; label: string; bg: string; color: string }> = [
  { key: 'PAGO_OK', label: 'Pago OK', bg: 'rgba(29,158,117,0.12)', color: '#1D9E75' },
  { key: 'AGUARDANDO_ENVIO', label: 'Aguardando envio', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'EM_TRANSITO', label: 'Em trânsito', bg: 'rgba(239,159,39,0.14)', color: '#EF9F27' },
  { key: 'ENTREGUE_AGUARDANDO_CONFIRMACAO', label: 'Entregue (aguardando)', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'AGUARDANDO_LIBERACAO', label: 'Aguardando liberação', bg: 'rgba(55,138,221,0.12)', color: '#378ADD' },
  { key: 'PAGO_COM_DIVERGENCIA', label: 'Pago c/ divergência', bg: 'rgba(239,159,39,0.14)', color: '#EF9F27' },
  { key: 'DEVOLVIDO', label: 'Devolvido', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'REEMBOLSADO_PARCIAL', label: 'Reembolsado parcial', bg: 'rgba(239,159,39,0.14)', color: '#EF9F27' },
  { key: 'EM_DISPUTA', label: 'Em disputa', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'ATRASO_DE_REPASSE', label: 'Atraso de repasse', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'CANCELADO', label: 'Cancelado', bg: 'rgba(156,163,175,0.14)', color: '#6b7280' },
  { key: 'SEM_VINCULO_FINANCEIRO', label: 'Sem vínculo', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'ORFAO_SHOPEE', label: 'Órfão Shopee', bg: 'rgba(226,75,74,0.12)', color: '#E24B4A' },
  { key: 'DADOS_INSUFICIENTES', label: 'Dados insuficientes', bg: 'rgba(156,163,175,0.14)', color: '#6b7280' },
];

const CATEGORIA_BADGES: Record<string, { bg: string; color: string; label: string }> = {
  custos_fbs: { bg: 'rgba(239,159,39,0.14)', color: '#B4760F', label: 'FBS' },
  custos_fsf: { bg: 'rgba(239,159,39,0.14)', color: '#B4760F', label: 'FSF' },
  custos_impostos: { bg: 'rgba(226,75,74,0.12)', color: '#A32D2D', label: 'Imposto' },
  compensacao: { bg: 'rgba(29,158,117,0.12)', color: '#16764f', label: 'Compensação' },
  custos_ajuste: { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Ajuste' },
  outros: { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Outro' },
};

function paymentBadge(method: string | null): { bg: string; color: string; label: string } {
  const m = (method ?? '').toLowerCase();
  if (m.includes('pix')) return { bg: 'rgba(29,158,117,0.12)', color: '#1D9E75', label: 'Pix' };
  if (m.includes('parcela') || m.includes('installment'))
    return { bg: 'rgba(55,138,221,0.12)', color: '#378ADD', label: 'Parcelado' };
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

  const barData = useMemo(() => {
    if (!data) return null;
    const labels = data.receita_por_dia.map(d => fmtDateShort(d.date));
    return {
      labels,
      datasets: [
        { label: 'Bruto', data: data.receita_por_dia.map(d => d.bruto), backgroundColor: COLORS.azul, borderRadius: 3, barPercentage: 0.7 },
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
          label: (ctx: any) =>
            `${ctx.dataset?.label ?? ''}: ${fmtBRLCompact(ctx.parsed?.y ?? 0)}`,
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
    const bc = data.breakdown_custos;
    return {
      labels: ['Líquido', 'Comissão', 'Taxa serviço', 'Ads', 'Afiliados', 'Devoluções', 'Outros'],
      datasets: [{
        data: [bc.liquido_pct, bc.comissao_pct, bc.taxa_pct, bc.ads_pct, bc.afiliados_pct, bc.devolucoes_pct, bc.outros_pct],
        backgroundColor: [COLORS.verde, COLORS.vermelho, COLORS.amber, COLORS.azul, COLORS.roxo, COLORS.vermelhoClaro, COLORS.cinza],
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
          label: (ctx: any) =>
            `${ctx.label ?? ''}: ${(ctx.parsed ?? 0).toFixed(1)}%`,
        },
      },
    },
  }), []);

  const k = data?.kpis;

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Financeiro Shopee</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Atualizado às {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          {data && ` · ${data.period.from} → ${data.period.to}`}
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
        <div className="card p-3 rounded-lg mb-4 text-xs" style={{ color: '#E24B4A' }}>
          Erro: {error}
        </div>
      )}

      {/* Seção 1: RECEITA E MARGEM */}
      <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-2">Receita e margem</h2>
      {loading || !k ? <Skeleton4 /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Faturamento bruto"
            value={fmtBRL(k.faturamento_bruto)}
            delta={k.faturamento_bruto_variacao}
            sub={`vs anterior: ${fmtPct(k.faturamento_bruto_variacao)}`}
          />
          <MetricCard
            label="Valor líquido (escrow)"
            value={fmtBRL(k.valor_liquido)}
            valueColor={COLORS.verde}
            sub={`${fmtPct(k.valor_liquido_pct)} do bruto`}
          />
          <MetricCard
            label="Comissão média"
            value={fmtPct(k.comissao_media_pct)}
            valueColor={COLORS.vermelho}
            sub={`${fmtBRL(k.comissao_media_valor)} por pedido`}
          />
          <MetricCard
            label="Custo total Shopee"
            value={fmtPct(k.custo_total_shopee_pct)}
            valueColor={COLORS.vermelho}
            sub="Comissão + taxa + ads + afiliados + devoluções"
          />
        </div>
      )}

      {/* Seção 2: CUSTOS */}
      <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-4">Custos</h2>
      {loading || !k ? <Skeleton4 /> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <MetricCard
            label="Comissão Shopee"
            value={fmtBRL(k.comissao_total)}
            valueColor={COLORS.vermelho}
            sub={`${fmtPct(k.comissao_pct)} do bruto`}
          />
          <MetricCard
            label="Taxa de serviço"
            value={fmtBRL(k.taxa_servico_total)}
            valueColor={COLORS.vermelho}
            sub={`${fmtPct(k.taxa_servico_pct)} do bruto`}
          />
          <MetricCard
            label="Gastos com Ads"
            value={fmtBRL(k.ads_total)}
            valueColor={COLORS.amber}
            sub={`ROAS ${k.ads_roas.toFixed(2)}x`}
          />
          <MetricCard
            label="Gastos com afiliados"
            value={fmtBRL(k.afiliados_total)}
            valueColor={COLORS.roxo}
            sub={`${fmtPct(k.afiliados_pct)} do bruto`}
          />
        </div>
      )}

      {/* Seção 3: INFORMATIVO */}
      <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-4">Informativo</h2>
      {loading || !k ? <Skeleton4 /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-2">
            <MetricCard
              label="Rebate Shopee"
              value={fmtBRL(k.rebate_shopee)}
              valueColor={COLORS.verde}
              sub="Shopee bancou (não é custo)"
              subColor={COLORS.verde}
            />
            <MetricCard
              label="Devoluções (frete)"
              value={fmtBRL(k.devolucoes_frete)}
              valueColor={COLORS.vermelho}
              sub={`${k.devolucoes_qtd} devoluções`}
            />
            <MetricCard
              label="Saques (retiradas)"
              value={fmtBRL(k.saques_total)}
              valueColor={COLORS.azul}
              sub="Transferido para conta PJ"
            />
            <div className="card p-4 rounded-lg">
              <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">Outros custos</p>
              <span className="text-lg font-medium">{fmtBRL(k.outros_custos)}</span>
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
                <p className="text-xs opacity-40">Nenhum custo classificado como &quot;outros&quot; no período</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left opacity-50">
                          <th className="pb-2">Tipo</th>
                          <th className="pb-2">Descrição</th>
                          <th className="pb-2">Categoria</th>
                          <th className="pb-2 text-right">Qtd</th>
                          <th className="pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.outros_custos_detalhe.map((o, i) => {
                          const cat = CATEGORIA_BADGES[o.categoria] ?? CATEGORIA_BADGES.outros;
                          return (
                            <tr key={`${o.transaction_type}-${i}`} className="border-t border-current/5">
                              <td className="py-1.5 font-mono text-[10px]">{o.transaction_type}</td>
                              <td className="py-1.5 max-w-[380px] truncate" title={o.description}>
                                {o.description || '—'}
                              </td>
                              <td className="py-1.5">
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                  style={{ background: cat.bg, color: cat.color }}
                                >
                                  {cat.label}
                                </span>
                              </td>
                              <td className="py-1.5 text-right">{o.count}</td>
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
                    Conforme novos tipos aparecerem, serão listados aqui para mapeamento.
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Seção 4: GRÁFICOS (2 colunas) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {/* Receita por dia */}
        <div className="card p-4 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-medium opacity-70">Receita por dia</h3>
            <div className="flex gap-3 text-[10px] opacity-70">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLORS.azul }} /> Bruto</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLORS.verde }} /> Líquido</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: COLORS.vermelho }} /> Ads</span>
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

        {/* Para onde vai o dinheiro */}
        <div className="card p-4 rounded-lg">
          <h3 className="text-xs font-medium opacity-70 mb-3">Para onde vai o dinheiro</h3>
          <div style={{ height: 180 }}>
            {loading || !donutData ? (
              <div className="h-full bg-current/5 rounded animate-pulse" />
            ) : (
              <Doughnut data={donutData} options={donutOptions} />
            )}
          </div>
          {data && (
            <div className="flex flex-wrap gap-2 mt-3 text-[10px]">
              {donutData && donutData.labels.map((lbl, idx) => (
                <span key={lbl} className="flex items-center gap-1 opacity-80">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: donutData.datasets[0].backgroundColor[idx] as string }}
                  />
                  {lbl} {(donutData.datasets[0].data[idx] as number).toFixed(1)}%
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Seção 5: STATUS DA CONCILIAÇÃO */}
      <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-4">Status da conciliação</h2>
      <div className="card p-4 rounded-lg mb-4">
        {loading || !data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="p-3 rounded animate-pulse bg-current/5" style={{ height: 60 }} />
            ))}
          </div>
        ) : (
          (() => {
            const visible = CONCILIACAO_DISPLAY.filter(c => (data.conciliacao[c.key] ?? 0) > 0);
            if (visible.length === 0) {
              return <p className="text-xs opacity-40">Nenhum pedido conciliado ainda</p>;
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
                      {data.conciliacao[c.key].toLocaleString('pt-BR')}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </div>

      {/* Seção 6: ÚLTIMOS PEDIDOS COM ESCROW */}
      <h2 className="text-[9px] uppercase tracking-wider opacity-50 mb-2 mt-4">Últimos pedidos com escrow</h2>
      <div className="card p-4 rounded-lg">
        {loading || !data ? (
          <div className="space-y-2">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-6 bg-current/5 rounded animate-pulse" />
            ))}
          </div>
        ) : data.ultimos_pedidos.length === 0 ? (
          <p className="text-xs opacity-40">Nenhum pedido com escrow ainda</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50">
                  <th className="pb-2">Pedido</th>
                  <th className="pb-2 text-right">Bruto</th>
                  <th className="pb-2 text-right">Comissão</th>
                  <th className="pb-2 text-right">Taxa</th>
                  <th className="pb-2 text-right">Líquido</th>
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
        )}
      </div>
    </div>
  );
}
