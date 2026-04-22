'use client';

import { useCallback, useEffect, useState } from 'react';

interface PedidoRow {
  shop_id: number;
  order_sn: string;
  tiny_numero_pedido: string | null;
  valor_bruto_shopee: number | null;
  valor_bruto_tiny: number | null;
  divergencia_valor: number | null;
  divergencia_percentual: number | null;
  observacoes: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  // Filtro de loja propagado do dashboard (all | <id>).
  shopFilter: string;
  // Dispara um refresh no dashboard pai após mudança — o contador do
  // card de conciliação precisa refletir a nova contagem.
  onChanged: () => void;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number | null | undefined): string {
  if (n == null) return '—';
  return BRL.format(n);
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(2)}%`;
}

function hasMarker(obs: string | null): { revisado: boolean; confirmado: boolean } {
  const s = (obs ?? '').toLowerCase();
  return {
    confirmado: s.includes('confirmado manualmente'),
    revisado:   s.includes('divergência confirmada') || s.includes('confirmado manualmente'),
  };
}

export function DivergenciasModal({ open, onClose, shopFilter, onChanged }: Props) {
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/shopee/conciliacao/divergencias?shop_id=${encodeURIComponent(shopFilter)}`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPedidos((json.pedidos as PedidoRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [shopFilter]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3500);
    return () => clearTimeout(t);
  }, [banner]);

  async function confirmarOk(p: PedidoRow) {
    if (!confirm(`Tem certeza que deseja marcar "${p.order_sn}" como pago corretamente? Essa ação será preservada mesmo quando o cron reprocessar.`)) {
      return;
    }
    setActingOn(p.order_sn);
    try {
      const res = await fetch('/api/shopee/conciliacao/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_sn: p.order_sn,
          shop_id: p.shop_id,
          acao: 'confirmar_ok',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      // Remove da lista localmente — o pedido não está mais em
      // PAGO_COM_DIVERGENCIA. Evita 1 roundtrip + flicker.
      setPedidos(curr => curr.filter(r => r.order_sn !== p.order_sn));
      setBanner({ type: 'success', message: `${p.order_sn} marcado como pago corretamente` });
      onChanged();
    } catch (err) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao confirmar' });
    } finally {
      setActingOn(null);
    }
  }

  async function manterDivergencia(p: PedidoRow) {
    const nota = prompt('Observação sobre a divergência (opcional):', '') ?? '';
    setActingOn(p.order_sn);
    try {
      const res = await fetch('/api/shopee/conciliacao/resolver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_sn: p.order_sn,
          shop_id: p.shop_id,
          acao: 'manter_divergencia',
          observacao: nota.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      // Mantém na lista, atualiza observacoes local para o badge refletir.
      setPedidos(curr =>
        curr.map(r =>
          r.order_sn === p.order_sn
            ? { ...r, observacoes: `${r.observacoes ?? ''} | Divergência confirmada em ${new Date().toLocaleDateString('pt-BR')}`.trim() }
            : r,
        ),
      );
      setBanner({ type: 'success', message: `${p.order_sn} marcado como revisado` });
      onChanged();
    } catch (err) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao registrar' });
    } finally {
      setActingOn(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden p-4"
      onClick={onClose}
    >
      <div
        className="card rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 pb-3 border-b border-current/10 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">Pedidos com divergência de valor</h3>
              <p className="text-[10px] opacity-50 mt-0.5">
                {loading
                  ? 'Carregando…'
                  : `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} com diferença > 2% entre Shopee e Tiny`}
              </p>
            </div>
            <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
          </div>
        </div>

        {banner && (
          <div
            className="mx-5 mt-3 rounded-md px-3 py-2 text-xs flex items-center justify-between gap-3"
            style={
              banner.type === 'success'
                ? { background: 'rgba(29,158,117,0.10)', color: '#1D9E75', border: '1px solid rgba(29,158,117,0.3)' }
                : { background: 'rgba(226,75,74,0.10)', color: '#E24B4A', border: '1px solid rgba(226,75,74,0.3)' }
            }
          >
            <span>{banner.message}</span>
            <button onClick={() => setBanner(null)} className="text-sm opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Body */}
        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-8 bg-current/5 rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="text-xs" style={{ color: '#E24B4A' }}>Erro: {error}</div>
          ) : pedidos.length === 0 ? (
            <p className="text-xs opacity-40 py-8 text-center">
              Nenhum pedido em PAGO_COM_DIVERGENCIA para o filtro atual.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left opacity-50 border-b border-current/10">
                    <th className="pb-2 pr-3 font-medium">Pedido Shopee</th>
                    <th className="pb-2 pr-3 font-medium">Pedido Tiny</th>
                    <th className="pb-2 pr-3 font-medium text-right">Shopee</th>
                    <th className="pb-2 pr-3 font-medium text-right">Tiny</th>
                    <th className="pb-2 pr-3 font-medium text-right">Divergência</th>
                    <th className="pb-2 pr-3 font-medium text-right">%</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map(p => {
                    const m = hasMarker(p.observacoes);
                    const divCor = (p.divergencia_valor ?? 0) >= 0 ? '#1D9E75' : '#E24B4A';
                    return (
                      <tr key={p.order_sn} className="border-t border-current/5 align-middle">
                        <td className="py-2 pr-3 font-mono text-[10px]">{p.order_sn}</td>
                        <td className="py-2 pr-3 font-mono text-[10px] opacity-80">
                          {p.tiny_numero_pedido ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-right">{fmtBRL(p.valor_bruto_shopee)}</td>
                        <td className="py-2 pr-3 text-right">{fmtBRL(p.valor_bruto_tiny)}</td>
                        <td className="py-2 pr-3 text-right font-medium" style={{ color: divCor }}>
                          {fmtBRL(p.divergencia_valor)}
                        </td>
                        <td className="py-2 pr-3 text-right" style={{ color: divCor }}>
                          {fmtPct(p.divergencia_percentual)}
                        </td>
                        <td className="py-2 pr-3">
                          {m.revisado ? (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ background: 'rgba(55,138,221,0.12)', color: '#1F5FA5' }}
                            >
                              Revisado
                            </span>
                          ) : (
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                              style={{ background: 'rgba(239,159,39,0.14)', color: '#8B5F0A' }}
                            >
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => confirmarOk(p)}
                            disabled={actingOn === p.order_sn}
                            className="px-2 py-1 text-[10px] rounded-md text-white hover:opacity-90 transition-opacity disabled:opacity-50 mr-1.5"
                            style={{ background: '#1D9E75' }}
                          >
                            Confirmar OK
                          </button>
                          <button
                            onClick={() => manterDivergencia(p)}
                            disabled={actingOn === p.order_sn}
                            className="px-2 py-1 text-[10px] rounded-md border border-current/15 hover:border-current/30 transition-colors disabled:opacity-50"
                          >
                            Manter divergência
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-current/10 shrink-0 flex items-center justify-end">
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
