'use client';

import { useCallback, useEffect, useState } from 'react';

type Tipo = 'take_rate' | 'afiliados' | 'devolucoes' | 'difal' | 'fbs' | 'subsidio';

interface Props {
  open: boolean;
  onClose: () => void;
  tipo: Tipo | null;
  from: string;   // YYYY-MM-DD (BRT)
  to: string;     // YYYY-MM-DD (BRT)
  shopFilter: string;
}

interface TakeRateRow {
  order_sn: string;
  buyer_total_amount: number;
  order_selling_price: number;
  commission_fee: number;
  service_fee: number;
  total_taxas: number;
  take_rate_pct: number;
  payment_method: string | null;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface AfiliadosRow {
  order_sn: string;
  order_selling_price: number;
  order_ams_commission_fee: number;
  afiliado_pct: number;
  commission_fee: number;
  service_fee: number;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface DevolucoesRow {
  order_sn: string;
  order_selling_price: number;
  reverse_shipping_fee: number;
  actual_shipping_fee: number;
  shopee_shipping_rebate: number;
  frete_ida_seller: number;
  custo_total_devolucao: number;
  seller_return_refund: number;
  escrow_amount: number;
  escrow_release_time: string | null;
}

interface DifalRow {
  id: number;
  order_sn_extraido: string | null;
  description: string;
  amount: number;
  create_time: string | null;
  shipping_carrier: string | null;
}

interface FbsRow {
  id: number;
  transaction_type: string;
  description: string;
  amount: number;
  create_time: string | null;
}

interface SubsidioRow {
  order_sn: string;
  order_selling_price: number;
  coins: number;
  voucher_from_shopee: number;
  shopee_discount: number;
  credit_card_promotion: number;
  pix_discount: number;
  total_subsidio: number;
  subsidio_pct: number;
  escrow_release_time: string | null;
}

type PedidoRow = TakeRateRow | AfiliadosRow | DevolucoesRow | DifalRow | FbsRow | SubsidioRow;

interface TakeRateResumo {
  total_pedidos: number;
  media_take_rate: number;
  total_comissao: number;
  total_taxa_servico: number;
  por_metodo_pagamento: Array<{ metodo: string; count: number; media_take_rate_pct: number }>;
}
interface AfiliadosResumo {
  total_pedidos_com_afiliado: number;
  total_pedidos_sem_afiliado: number;
  pct_pedidos_afiliado: number;
  total_gasto_afiliados: number;
  media_comissao_afiliado: number;
}
interface DevolucoesResumo {
  total_devolucoes: number;
  total_frete_reverso: number;
  total_frete_ida_seller: number;
  custo_total: number;
  total_reembolsado: number;
  pedidos_negativos: number;
}
interface WalletResumo {
  total_cobrancas: number;
  total_valor: number;
  media_por_cobranca: number;
}
interface SubsidioResumo {
  total_pedidos_com_subsidio: number;
  total_subsidio: number;
  total_coins: number;
  total_voucher_shopee: number;
  total_pix_discount: number;
  total_shopee_discount: number;
  total_credit_card_promo: number;
}

interface ApiResponse {
  tipo: Tipo;
  resumo: Partial<
    TakeRateResumo & AfiliadosResumo & DevolucoesResumo & WalletResumo & SubsidioResumo
  >;
  pedidos: PedidoRow[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

const SORT_OPTIONS: Record<Tipo, Array<{ value: string; label: string }>> = {
  take_rate: [
    { value: 'take_rate_pct',      label: 'Take rate %' },
    { value: 'total_taxas',        label: 'Total taxas' },
    { value: 'buyer_total_amount', label: 'GMV (bruto)' },
    { value: 'commission_fee',     label: 'Comissão' },
    { value: 'service_fee',        label: 'Taxa serviço' },
  ],
  afiliados: [
    { value: 'order_ams_commission_fee', label: 'Comissão afiliado' },
    { value: 'afiliado_pct',             label: '% do pedido' },
    { value: 'order_selling_price',      label: 'Valor do produto' },
  ],
  devolucoes: [
    { value: 'custo_total_devolucao', label: 'Custo total' },
    { value: 'reverse_shipping_fee',  label: 'Frete reverso' },
    { value: 'frete_ida_seller',      label: 'Frete ida' },
    { value: 'seller_return_refund',  label: 'Reembolso' },
    { value: 'escrow_amount',         label: 'Renda do pedido' },
  ],
  difal: [
    { value: 'amount',      label: 'Valor' },
    { value: 'create_time', label: 'Data' },
  ],
  fbs: [
    { value: 'amount',      label: 'Valor' },
    { value: 'create_time', label: 'Data' },
  ],
  subsidio: [
    { value: 'total_subsidio',      label: 'Total subsídio' },
    { value: 'subsidio_pct',        label: '% do pedido' },
    { value: 'coins',               label: 'Coins' },
    { value: 'voucher_from_shopee', label: 'Voucher Shopee' },
    { value: 'pix_discount',        label: 'Pix discount' },
  ],
};

const TITULO: Record<Tipo, string> = {
  take_rate:  'Detalhamento: Take Rate',
  afiliados:  'Detalhamento: Afiliados',
  devolucoes: 'Detalhamento: Devoluções',
  difal:      'Detalhamento: DIFAL (ICMS)',
  fbs:        'Detalhamento: FBS (Fulfillment)',
  subsidio:   'Detalhamento: Subsídio Shopee',
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return BRL.format(n);
}
function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}%`;
}
function fmtInt(n: number): string { return n.toLocaleString('pt-BR'); }
function fmtData(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function takeRateBadge(pct: number): { bg: string; color: string } {
  if (pct < 25) return { bg: 'rgba(29,158,117,0.12)', color: '#1D9E75' };
  if (pct <= 30) return { bg: 'rgba(239,159,39,0.14)', color: '#8B5F0A' };
  return { bg: 'rgba(226,75,74,0.12)', color: '#A32D2D' };
}

function paymentBadge(method: string | null): { bg: string; color: string; label: string } {
  const m = (method ?? '').toLowerCase();
  if (m.includes('pix'))
    return { bg: 'rgba(55,138,221,0.12)', color: '#1F5FA5', label: 'Pix' };
  if (m.includes('parcela') || m.includes('installment') || m.includes('sparcel'))
    return { bg: 'rgba(239,159,39,0.14)', color: '#8B5F0A', label: 'SParcelado' };
  if (m.includes('card') || m.includes('cart') || m.includes('credit'))
    return { bg: 'rgba(127,119,221,0.14)', color: '#4B44A1', label: 'Cartão' };
  return { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: method ?? '—' };
}

export function DetalhesModal({ open, onClose, tipo, from, to, shopFilter }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros locais do modal — persistem enquanto o modal está aberto.
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<string>('');
  const [direcao, setDirecao] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  // Reseta filtros ao trocar de tipo.
  useEffect(() => {
    if (!tipo) return;
    setOrdem(SORT_OPTIONS[tipo][0].value);
    setDirecao('desc');
    setBusca('');
    setPage(1);
  }, [tipo]);

  const load = useCallback(async () => {
    if (!tipo || !from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        tipo, from, to,
        shop_id: shopFilter,
        ordem: ordem || SORT_OPTIONS[tipo][0].value,
        direcao,
        page: String(page),
        limit: '50',
      });
      if (busca.trim()) params.set('busca', busca.trim());
      const res = await fetch(`/api/shopee/financeiro/detalhes?${params}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [tipo, from, to, shopFilter, ordem, direcao, page, busca]);

  // Debounce da busca — evita refetch a cada tecla.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => { load(); }, busca ? 300 : 0);
    return () => clearTimeout(id);
  }, [open, load, busca]);

  if (!open || !tipo) return null;

  const total = data?.pagination.total ?? 0;
  const pagination = data?.pagination ?? { page: 1, limit: 50, total: 0, total_pages: 0 };
  const inicio = total === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1;
  const fim = Math.min(total, pagination.page * pagination.limit);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 border-b border-current/10 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">{TITULO[tipo]}</h3>
              <p className="text-[10px] opacity-50 mt-0.5">
                {loading
                  ? 'Carregando…'
                  : `${fmtInt(total)} ${total === 1 ? 'pedido' : 'pedidos'} no período`}
              </p>
            </div>
            <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
          </div>
        </div>

        {/* Body scrollável */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-3">
          {/* Resumo */}
          {data && <ResumoBlock tipo={tipo} resumo={data.resumo} />}

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); setPage(1); }}
              placeholder="Buscar por número do pedido…"
              className="px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent flex-1 min-w-[200px]"
            />
            <select
              value={ordem}
              onChange={e => { setOrdem(e.target.value); setPage(1); }}
              className="px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
            >
              {SORT_OPTIONS[tipo].map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => { setDirecao(d => d === 'asc' ? 'desc' : 'asc'); setPage(1); }}
              className="px-2.5 py-1.5 text-xs rounded border border-current/15 hover:border-current/30 transition-colors"
              title={direcao === 'asc' ? 'Ascendente' : 'Descendente'}
            >
              {direcao === 'asc' ? '↑ ASC' : '↓ DESC'}
            </button>
          </div>

          {/* Tabela */}
          {loading && !data ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="h-8 bg-current/5 rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="text-xs" style={{ color: '#E24B4A' }}>Erro: {error}</div>
          ) : !data || data.pedidos.length === 0 ? (
            <p className="text-xs opacity-40 py-8 text-center">
              Nenhum pedido encontrado com os filtros atuais.
            </p>
          ) : (
            <div className="overflow-x-auto">
              {tipo === 'take_rate' && <TakeRateTable rows={data.pedidos as TakeRateRow[]} />}
              {tipo === 'afiliados' && <AfiliadosTable rows={data.pedidos as AfiliadosRow[]} />}
              {tipo === 'devolucoes' && <DevolucoesTable rows={data.pedidos as DevolucoesRow[]} />}
              {tipo === 'difal' && <DifalTable rows={data.pedidos as DifalRow[]} />}
              {tipo === 'fbs' && <FbsTable rows={data.pedidos as FbsRow[]} />}
              {tipo === 'subsidio' && <SubsidioTable rows={data.pedidos as SubsidioRow[]} />}
            </div>
          )}
        </div>

        {/* Footer + paginação */}
        <div className="p-4 border-t border-current/10 shrink-0 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-[11px] opacity-60">
            {total === 0
              ? 'Nenhum pedido'
              : `Mostrando ${fmtInt(inicio)}-${fmtInt(fim)} de ${fmtInt(total)} pedidos`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={pagination.page <= 1 || loading}
              className="px-2.5 py-1 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors disabled:opacity-40"
            >
              ← Anterior
            </button>
            <span className="text-[11px] opacity-60">
              Página {pagination.page} de {Math.max(1, pagination.total_pages)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={pagination.page >= pagination.total_pages || loading}
              className="px-2.5 py-1 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors disabled:opacity-40"
            >
              Próximo →
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors ml-2"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =======================================================================
// RESUMO
// =======================================================================

function MiniCard({
  label, value, valueColor,
}: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'rgba(128,128,128,0.06)' }}>
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-sm font-medium" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </p>
    </div>
  );
}

function ResumoBlock({
  tipo, resumo,
}: {
  tipo: Tipo;
  resumo: Partial<
    TakeRateResumo & AfiliadosResumo & DevolucoesResumo & WalletResumo & SubsidioResumo
  >;
}) {
  if (tipo === 'take_rate') {
    const mediaColor = (resumo.media_take_rate ?? 0) < 25
      ? '#1D9E75'
      : (resumo.media_take_rate ?? 0) <= 30 ? '#8B5F0A' : '#A32D2D';
    return (
      <div className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          <MiniCard label="Pedidos" value={fmtInt(resumo.total_pedidos ?? 0)} />
          <MiniCard label="Take rate médio" value={fmtPct(resumo.media_take_rate ?? 0)} valueColor={mediaColor} />
          <MiniCard label="Total comissão" value={fmtBRL(resumo.total_comissao ?? 0)} valueColor="#A32D2D" />
          <MiniCard label="Total taxa serviço" value={fmtBRL(resumo.total_taxa_servico ?? 0)} valueColor="#A32D2D" />
        </div>
        {resumo.por_metodo_pagamento && resumo.por_metodo_pagamento.length > 0 && (
          <div className="rounded-lg p-3" style={{ background: 'rgba(128,128,128,0.06)' }}>
            <p className="text-[9px] uppercase tracking-wider opacity-50 mb-2">Take rate por método de pagamento</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50">
                  <th className="pb-1 font-medium">Método</th>
                  <th className="pb-1 font-medium text-right">Pedidos</th>
                  <th className="pb-1 font-medium text-right">Take rate médio</th>
                </tr>
              </thead>
              <tbody>
                {resumo.por_metodo_pagamento.map(m => {
                  const pb = paymentBadge(m.metodo);
                  return (
                    <tr key={m.metodo} className="border-t border-current/5">
                      <td className="py-1.5">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: pb.bg, color: pb.color }}>
                          {pb.label}
                        </span>
                      </td>
                      <td className="py-1.5 text-right">{fmtInt(m.count)}</td>
                      <td className="py-1.5 text-right">{fmtPct(m.media_take_rate_pct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }
  if (tipo === 'afiliados') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <MiniCard
          label="Com afiliado"
          value={`${fmtInt(resumo.total_pedidos_com_afiliado ?? 0)} (${fmtPct(resumo.pct_pedidos_afiliado ?? 0)})`}
          valueColor="#4B44A1"
        />
        <MiniCard
          label="Sem afiliado"
          value={fmtInt(resumo.total_pedidos_sem_afiliado ?? 0)}
        />
        <MiniCard label="Total gasto" value={fmtBRL(resumo.total_gasto_afiliados ?? 0)} valueColor="#4B44A1" />
        <MiniCard label="Média por pedido" value={fmtBRL(resumo.media_comissao_afiliado ?? 0)} />
      </div>
    );
  }
  if (tipo === 'devolucoes') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        <MiniCard label="Total devoluções" value={fmtInt(resumo.total_devolucoes ?? 0)} />
        <MiniCard label="Frete reverso" value={fmtBRL(resumo.total_frete_reverso ?? 0)} valueColor="#A32D2D" />
        <MiniCard label="Frete ida (seller)" value={fmtBRL(resumo.total_frete_ida_seller ?? 0)} valueColor="#A32D2D" />
        <MiniCard label="Custo total" value={fmtBRL(resumo.custo_total ?? 0)} valueColor="#A32D2D" />
        <MiniCard label="Total reembolsado" value={fmtBRL(resumo.total_reembolsado ?? 0)} />
      </div>
    );
  }
  if (tipo === 'difal' || tipo === 'fbs') {
    const totalLabel = tipo === 'difal' ? 'Total DIFAL' : 'Total FBS';
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <MiniCard label="Cobranças" value={fmtInt(resumo.total_cobrancas ?? 0)} />
        <MiniCard label={totalLabel} value={fmtBRL(resumo.total_valor ?? 0)} valueColor="#A32D2D" />
        <MiniCard label="Média por cobrança" value={fmtBRL(resumo.media_por_cobranca ?? 0)} />
      </div>
    );
  }
  // subsidio
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
      <MiniCard label="Pedidos com subsídio" value={fmtInt(resumo.total_pedidos_com_subsidio ?? 0)} />
      <MiniCard label="Total subsídio" value={fmtBRL(resumo.total_subsidio ?? 0)} valueColor="#1D9E75" />
      <MiniCard label="Total coins" value={fmtBRL(resumo.total_coins ?? 0)} />
      <MiniCard label="Total voucher Shopee" value={fmtBRL(resumo.total_voucher_shopee ?? 0)} />
      <MiniCard label="Total pix discount" value={fmtBRL(resumo.total_pix_discount ?? 0)} />
    </div>
  );
}

// =======================================================================
// TABELAS
// =======================================================================

function TakeRateTable({ rows }: { rows: TakeRateRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Pedido</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor produto</th>
          <th className="pb-2 pr-3 font-medium text-right">Comissão</th>
          <th className="pb-2 pr-3 font-medium text-right">Taxa serviço</th>
          <th className="pb-2 pr-3 font-medium text-right">Total taxas</th>
          <th className="pb-2 pr-3 font-medium text-right">Take rate %</th>
          <th className="pb-2 pr-3 font-medium">Pagamento</th>
          <th className="pb-2 font-medium text-right">Receita líquida</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const trBadge = takeRateBadge(r.take_rate_pct);
          const pb = paymentBadge(r.payment_method);
          return (
            <tr key={r.order_sn} className="border-t border-current/5">
              <td className="py-2 pr-3 font-mono text-[10px]">{r.order_sn}</td>
              <td className="py-2 pr-3 text-right">{fmtBRL(r.order_selling_price)}</td>
              <td className="py-2 pr-3 text-right" style={{ color: '#A32D2D' }}>{fmtBRL(r.commission_fee)}</td>
              <td className="py-2 pr-3 text-right" style={{ color: '#A32D2D' }}>{fmtBRL(r.service_fee)}</td>
              <td className="py-2 pr-3 text-right font-medium" style={{ color: '#A32D2D' }}>{fmtBRL(r.total_taxas)}</td>
              <td className="py-2 pr-3 text-right">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ background: trBadge.bg, color: trBadge.color }}
                >
                  {fmtPct(r.take_rate_pct)}
                </span>
              </td>
              <td className="py-2 pr-3">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: pb.bg, color: pb.color }}>
                  {pb.label}
                </span>
              </td>
              <td className="py-2 text-right" style={{ color: r.escrow_amount >= 0 ? '#1D9E75' : '#E24B4A' }}>
                {fmtBRL(r.escrow_amount)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AfiliadosTable({ rows }: { rows: AfiliadosRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Pedido</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor produto</th>
          <th className="pb-2 pr-3 font-medium text-right">Comissão afiliado</th>
          <th className="pb-2 pr-3 font-medium text-right">% do pedido</th>
          <th className="pb-2 pr-3 font-medium text-right">Comissão Shopee</th>
          <th className="pb-2 pr-3 font-medium text-right">Taxa serviço</th>
          <th className="pb-2 font-medium text-right">Receita líquida</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pctBadge = r.afiliado_pct < 5
            ? { bg: 'rgba(29,158,117,0.12)', color: '#1D9E75' }
            : r.afiliado_pct <= 10
              ? { bg: 'rgba(239,159,39,0.14)', color: '#8B5F0A' }
              : { bg: 'rgba(226,75,74,0.12)', color: '#A32D2D' };
          return (
            <tr key={r.order_sn} className="border-t border-current/5">
              <td className="py-2 pr-3 font-mono text-[10px]">{r.order_sn}</td>
              <td className="py-2 pr-3 text-right">{fmtBRL(r.order_selling_price)}</td>
              <td className="py-2 pr-3 text-right font-medium" style={{ color: '#4B44A1' }}>
                {fmtBRL(r.order_ams_commission_fee)}
              </td>
              <td className="py-2 pr-3 text-right">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ background: pctBadge.bg, color: pctBadge.color }}
                >
                  {fmtPct(r.afiliado_pct)}
                </span>
              </td>
              <td className="py-2 pr-3 text-right" style={{ color: '#A32D2D' }}>{fmtBRL(r.commission_fee)}</td>
              <td className="py-2 pr-3 text-right" style={{ color: '#A32D2D' }}>{fmtBRL(r.service_fee)}</td>
              <td className="py-2 text-right" style={{ color: r.escrow_amount >= 0 ? '#1D9E75' : '#E24B4A' }}>
                {fmtBRL(r.escrow_amount)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DifalTable({ rows }: { rows: DifalRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Pedido</th>
          <th className="pb-2 pr-3 font-medium">Descrição</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor</th>
          <th className="pb-2 font-medium text-right">Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-current/5">
            <td className="py-2 pr-3 font-mono text-[10px] whitespace-nowrap">
              {r.order_sn_extraido ?? <span className="opacity-40">—</span>}
            </td>
            <td className="py-2 pr-3 max-w-[340px] truncate" title={r.description}>
              {r.description || '—'}
              {r.shipping_carrier && (
                <span className="ml-2 text-[9px] opacity-50">({r.shipping_carrier})</span>
              )}
            </td>
            <td className="py-2 pr-3 text-right font-medium" style={{ color: '#A32D2D' }}>
              {fmtBRL(r.amount)}
            </td>
            <td className="py-2 text-right whitespace-nowrap opacity-70">
              {fmtData(r.create_time)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FbsTable({ rows }: { rows: FbsRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Tipo</th>
          <th className="pb-2 pr-3 font-medium">Descrição</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor</th>
          <th className="pb-2 font-medium text-right">Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-current/5">
            <td className="py-2 pr-3">
              <span
                className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                style={{ background: 'rgba(226,75,74,0.12)', color: '#A32D2D' }}
              >
                {r.transaction_type}
              </span>
            </td>
            <td className="py-2 pr-3 max-w-[420px] truncate" title={r.description}>
              {r.description || '—'}
            </td>
            <td className="py-2 pr-3 text-right font-medium" style={{ color: '#A32D2D' }}>
              {fmtBRL(r.amount)}
            </td>
            <td className="py-2 text-right whitespace-nowrap opacity-70">
              {fmtData(r.create_time)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SubsidioTable({ rows }: { rows: SubsidioRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Pedido</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor produto</th>
          <th className="pb-2 pr-3 font-medium text-right">Coins</th>
          <th className="pb-2 pr-3 font-medium text-right">Voucher Shopee</th>
          <th className="pb-2 pr-3 font-medium text-right">Pix discount</th>
          <th className="pb-2 pr-3 font-medium text-right">Total subsídio</th>
          <th className="pb-2 font-medium text-right">% do pedido</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const pctBadge = r.subsidio_pct > 0
            ? { bg: 'rgba(29,158,117,0.12)', color: '#1D9E75' }
            : { bg: 'rgba(156,163,175,0.14)', color: '#4b5563' };
          return (
            <tr key={r.order_sn} className="border-t border-current/5">
              <td className="py-2 pr-3 font-mono text-[10px]">{r.order_sn}</td>
              <td className="py-2 pr-3 text-right">{fmtBRL(r.order_selling_price)}</td>
              <td className="py-2 pr-3 text-right" style={{ color: r.coins > 0 ? '#1D9E75' : undefined, opacity: r.coins > 0 ? 1 : 0.4 }}>
                {fmtBRL(r.coins)}
              </td>
              <td className="py-2 pr-3 text-right" style={{ color: r.voucher_from_shopee > 0 ? '#1D9E75' : undefined, opacity: r.voucher_from_shopee > 0 ? 1 : 0.4 }}>
                {fmtBRL(r.voucher_from_shopee)}
              </td>
              <td className="py-2 pr-3 text-right" style={{ color: r.pix_discount > 0 ? '#1D9E75' : undefined, opacity: r.pix_discount > 0 ? 1 : 0.4 }}>
                {fmtBRL(r.pix_discount)}
              </td>
              <td className="py-2 pr-3 text-right font-medium" style={{ color: '#1D9E75' }}>
                {fmtBRL(r.total_subsidio)}
              </td>
              <td className="py-2 text-right">
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ background: pctBadge.bg, color: pctBadge.color }}
                >
                  {fmtPct(r.subsidio_pct)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DevolucoesTable({ rows }: { rows: DevolucoesRow[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left opacity-50 border-b border-current/10">
          <th className="pb-2 pr-3 font-medium">Pedido</th>
          <th className="pb-2 pr-3 font-medium text-right">Valor produto</th>
          <th className="pb-2 pr-3 font-medium text-right">Frete reverso</th>
          <th className="pb-2 pr-3 font-medium text-right">Frete ida</th>
          <th className="pb-2 pr-3 font-medium text-right">Custo total</th>
          <th className="pb-2 pr-3 font-medium text-right">Reembolso</th>
          <th className="pb-2 font-medium text-right">Renda do pedido</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.order_sn} className="border-t border-current/5">
            <td className="py-2 pr-3 font-mono text-[10px]">{r.order_sn}</td>
            <td className="py-2 pr-3 text-right">{fmtBRL(r.order_selling_price)}</td>
            <td className="py-2 pr-3 text-right" style={{ color: '#A32D2D' }}>{fmtBRL(r.reverse_shipping_fee)}</td>
            <td className="py-2 pr-3 text-right" style={{ color: r.frete_ida_seller > 0 ? '#A32D2D' : undefined }}>
              {fmtBRL(r.frete_ida_seller)}
            </td>
            <td className="py-2 pr-3 text-right font-medium" style={{ color: '#A32D2D' }}>{fmtBRL(r.custo_total_devolucao)}</td>
            <td className="py-2 pr-3 text-right">{fmtBRL(r.seller_return_refund)}</td>
            <td className="py-2 text-right font-medium" style={{ color: r.escrow_amount >= 0 ? '#1D9E75' : '#E24B4A' }}>
              {fmtBRL(r.escrow_amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
