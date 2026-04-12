'use client';

import { useState } from 'react';
import type { SkuPaiAgrupado, SkuDetalhe } from '../types';
import { formatBRL, formatNumero } from '../lib/date-utils';
import { getSkuDetalhes } from '../lib/vendas-queries';

interface Props {
  data: SkuPaiAgrupado[];
  loading: boolean;
  startDate: string;
  endDate: string;
  loja?: string;
}

export function TopSkus({ data, loading, startDate, endDate, loja }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [modalSku, setModalSku] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<SkuDetalhe[]>([]);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [orderBy, setOrderBy] = useState<'faturamento' | 'quantidade'>('faturamento');

  const sorted = [...data].sort((a, b) =>
    orderBy === 'faturamento' ? b.faturamentoTotal - a.faturamentoTotal : b.quantidadeTotal - a.quantidadeTotal
  );
  const visivel = showAll ? sorted : sorted.slice(0, 10);
  const restantes = sorted.length - 10;

  async function abrirDetalhes(skuPai: string) {
    setModalSku(skuPai);
    setLoadingDetalhes(true);
    const det = await getSkuDetalhes(skuPai, startDate, endDate, loja);
    setDetalhes(det);
    setLoadingDetalhes(false);
  }

  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[200px] bg-current/5 rounded" /></div>;
  }

  return (
    <div className="card p-4 rounded-lg relative">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium opacity-70">Top SKUs</h3>
        <div className="flex gap-1">
          {(['faturamento', 'quantidade'] as const).map(o => (
            <button key={o} onClick={() => setOrderBy(o)}
              className={`px-2 py-0.5 text-[10px] rounded ${orderBy === o ? 'bg-[#378ADD] text-white' : 'opacity-50'}`}>
              {o === 'faturamento' ? 'R$' : 'Qtd'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {visivel.map(sku => (
          <div key={sku.skuPai} className="flex items-center justify-between py-1">
            <div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#378ADD]/15 text-[#378ADD]">#{sku.skuPai}</span>
              <p className="text-[8px] opacity-30 mt-0.5">{sku.variacoes.slice(0, 4).join(' · ')}{sku.variacoes.length > 4 ? ' ...' : ''}</p>
              <button onClick={() => abrirDetalhes(sku.skuPai)}
                className="text-[9px] text-[#378ADD] hover:underline">ver tamanhos ↗</button>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium">{formatBRL(sku.faturamentoTotal)}</p>
              <p className="text-[10px] opacity-40">{formatNumero(sku.quantidadeTotal)} pçs</p>
            </div>
          </div>
        ))}
      </div>

      {restantes > 0 && !showAll && (
        <button onClick={() => setShowAll(true)} className="text-[10px] text-[#378ADD] mt-2 hover:underline">
          + {restantes} SKUs restantes · ver todos
        </button>
      )}

      {/* Modal de detalhes */}
      {modalSku && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalSku(null)}>
          <div className="card p-6 rounded-lg max-w-lg w-full mx-4 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">SKU #{modalSku} — detalhes por variação</h3>
              <button onClick={() => setModalSku(null)} className="text-lg opacity-50 hover:opacity-100">×</button>
            </div>
            {loadingDetalhes ? (
              <div className="animate-pulse h-20 bg-current/5 rounded" />
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="text-left opacity-50">
                  <th className="pb-2">Variação</th><th className="pb-2">Descrição</th><th className="pb-2 text-right">Qtd</th>
                  <th className="pb-2 text-right">Fat.</th><th className="pb-2 text-right">%</th>
                </tr></thead>
                <tbody>
                  {detalhes.map(d => (
                    <tr key={d.sku} className="border-t border-current/5">
                      <td className="py-1.5 font-mono">{d.sku}</td>
                      <td className="py-1.5 opacity-60 max-w-[150px] truncate">{d.descricao}</td>
                      <td className="py-1.5 text-right">{formatNumero(d.quantidade)}</td>
                      <td className="py-1.5 text-right">{formatBRL(d.faturamento)}</td>
                      <td className="py-1.5 text-right">{d.percentual.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
