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

// Tipo para agrupamento por cor
interface CorAgrupada {
  cor: string;
  variacoes: string[];
  quantidade: number;
  faturamento: number;
  percentual: number;
}

// Extrai a letra de cor entre número inicial e hífen
function extrairCor(sku: string): string {
  const match = sku.match(/^\d+([A-Za-z]+)-/);
  return match ? match[1].toUpperCase() : '—';
}

// Agrupa detalhes por cor
function agruparPorCor(itens: SkuDetalhe[]): CorAgrupada[] {
  const totalGeral = itens.reduce((sum, i) => sum + i.faturamento, 0);

  const map: Record<string, { cor: string; variacoes: string[]; quantidade: number; faturamento: number }> = {};
  for (const item of itens) {
    const cor = extrairCor(item.sku);
    if (!map[cor]) {
      map[cor] = { cor, variacoes: [], quantidade: 0, faturamento: 0 };
    }
    map[cor].variacoes.push(item.sku);
    map[cor].quantidade += item.quantidade;
    map[cor].faturamento += item.faturamento;
  }

  return Object.values(map)
    .map(c => ({
      ...c,
      percentual: totalGeral > 0 ? (c.faturamento / totalGeral) * 100 : 0,
      variacoes: Array.from(new Set(c.variacoes)),
    }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

// Paleta de cores para badges
const COR_PALETTE = [
  { bg: '#E6F1FB', text: '#185FA5' },
  { bg: '#EEEDFE', text: '#534AB7' },
  { bg: '#FAEEDA', text: '#854F0B' },
  { bg: '#E1F5EE', text: '#0F6E56' },
  { bg: '#FAECE7', text: '#993C1D' },
  { bg: '#FBEAF0', text: '#72243E' },
  { bg: '#F1EFE8', text: '#5F5E5A' },
];

export function TopSkus({ data, loading, startDate, endDate, loja }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [modalSku, setModalSku] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<SkuDetalhe[]>([]);
  const [loadingDetalhes, setLoadingDetalhes] = useState(false);
  const [orderBy, setOrderBy] = useState<'faturamento' | 'quantidade'>('faturamento');
  const [tab, setTab] = useState<'variacao' | 'cor'>('variacao');

  const sorted = [...data].sort((a, b) =>
    orderBy === 'faturamento' ? b.faturamentoTotal - a.faturamentoTotal : b.quantidadeTotal - a.quantidadeTotal
  );
  const visivel = showAll ? sorted : sorted.slice(0, 10);
  const restantes = sorted.length - 10;

  async function abrirDetalhes(skuPai: string) {
    setModalSku(skuPai);
    setTab('variacao');
    setLoadingDetalhes(true);
    const det = await getSkuDetalhes(skuPai, startDate, endDate, loja);
    setDetalhes(det);
    setLoadingDetalhes(false);
  }

  // Totais para rodapé
  const totalFat = detalhes.reduce((s, d) => s + d.faturamento, 0);
  const totalQtd = detalhes.reduce((s, d) => s + d.quantidade, 0);

  // Variações do SKU pai para subtítulo
  const skuPaiData = data.find(s => s.skuPai === modalSku);

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden" onClick={() => setModalSku(null)}>
          <div className="card rounded-lg max-w-lg w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 pb-0 shrink-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-medium">SKU #{modalSku} — detalhes</h3>
                <button onClick={() => setModalSku(null)} className="text-lg opacity-50 hover:opacity-100">×</button>
              </div>
              {skuPaiData && (
                <p className="text-[9px] opacity-40">
                  {skuPaiData.variacoes.slice(0, 6).join(' · ')} — {detalhes.length} variações
                </p>
              )}
            </div>

            {/* Tabs */}
            <div className="shrink-0" style={{ display: 'flex', gap: 6, padding: '12px 18px', borderBottom: '0.5px solid var(--bord, rgba(128,128,128,0.15))' }}>
              <button
                onClick={() => setTab('variacao')}
                style={{
                  fontSize: 10, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                  border: tab === 'variacao' ? '0.5px solid #378ADD' : '0.5px solid var(--bord, rgba(128,128,128,0.15))',
                  background: tab === 'variacao' ? '#378ADD' : 'transparent',
                  color: tab === 'variacao' ? 'white' : 'var(--txt2, #9ca3af)',
                }}
              >
                Por variação
              </button>
              <button
                onClick={() => setTab('cor')}
                style={{
                  fontSize: 10, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                  border: tab === 'cor' ? '0.5px solid #378ADD' : '0.5px solid var(--bord, rgba(128,128,128,0.15))',
                  background: tab === 'cor' ? '#378ADD' : 'transparent',
                  color: tab === 'cor' ? 'white' : 'var(--txt2, #9ca3af)',
                }}
              >
                Por cor
              </button>
            </div>

            {/* Body scrollável */}
            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-3">
              {loadingDetalhes ? (
                <div className="animate-pulse h-20 bg-current/5 rounded" />
              ) : tab === 'variacao' ? (
                /* Visão Por variação */
                <table className="w-full text-xs">
                  <thead><tr className="text-left opacity-50">
                    <th className="pb-2">SKU</th><th className="pb-2 text-right">Qtd</th>
                    <th className="pb-2 text-right">Faturamento</th><th className="pb-2 text-right">Repr.</th>
                  </tr></thead>
                  <tbody>
                    {detalhes.map(d => {
                      const maxFat = detalhes.length > 0 ? detalhes[0].faturamento : 0;
                      return (
                        <tr key={d.sku} className="border-t border-current/5">
                          <td className="py-1.5">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{ background: '#E6F1FB', color: '#185FA5' }}>{d.sku}</span>
                          </td>
                          <td className="py-1.5 text-right">{formatNumero(d.quantidade)}</td>
                          <td className={`py-1.5 text-right font-medium ${d.faturamento === maxFat ? 'text-[#1D9E75]' : ''}`}>
                            {formatBRL(d.faturamento)}
                          </td>
                          <td className="py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div style={{ width: 60, height: 5, background: 'var(--bg3, rgba(128,128,128,0.1))', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${d.percentual}%`, height: '100%', background: '#378ADD', borderRadius: 3 }} />
                              </div>
                              <span className="text-[9px] opacity-60">{d.percentual.toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                /* Visão Por cor */
                <CorTable detalhes={detalhes} />
              )}
            </div>

            {/* Rodapé */}
            <div className="px-5 pb-4 shrink-0">
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '0.5px solid var(--bord, rgba(128,128,128,0.15))', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--txt3, #6b7280)', fontWeight: 500 }}>Total</span>
                <span style={{ fontSize: 11, fontWeight: 500 }}>
                  {formatBRL(totalFat)} · {formatNumero(totalQtd)} pç
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente da tabela por cor (separado para clareza)
function CorTable({ detalhes }: { detalhes: SkuDetalhe[] }) {
  const agrupadas = agruparPorCor(detalhes);
  const maxFat = agrupadas.length > 0 ? agrupadas[0].faturamento : 0;

  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left opacity-50">
        <th className="pb-2">Cor</th><th className="pb-2 text-right">Qtd</th>
        <th className="pb-2 text-right">Faturamento</th><th className="pb-2 text-right">Repr.</th>
      </tr></thead>
      <tbody>
        {agrupadas.map((c, idx) => (
          <tr key={c.cor} className="border-t border-current/5">
            <td className="py-1.5">
              <span style={{
                fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                background: COR_PALETTE[idx % COR_PALETTE.length].bg,
                color: COR_PALETTE[idx % COR_PALETTE.length].text,
                display: 'inline-block',
              }}>
                {c.cor}
              </span>
            </td>
            <td className="py-1.5 text-right">{formatNumero(c.quantidade)}</td>
            <td className={`py-1.5 text-right font-medium ${c.faturamento === maxFat ? 'text-[#1D9E75]' : ''}`}>
              {formatBRL(c.faturamento)}
            </td>
            <td className="py-1.5 text-right">
              <div className="flex items-center justify-end gap-1.5">
                <div style={{ width: 60, height: 5, background: 'var(--bg3, rgba(128,128,128,0.1))', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${c.percentual}%`, height: '100%', background: '#378ADD', borderRadius: 3 }} />
                </div>
                <span className="text-[9px] opacity-60">{c.percentual.toFixed(0)}%</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
