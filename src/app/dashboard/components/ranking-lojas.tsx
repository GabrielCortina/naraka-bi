'use client';

import type { LojaRanking } from '../types';
import { formatBRL, formatNumero } from '../lib/date-utils';

interface Props {
  data: LojaRanking[];
  loading: boolean;
}

export function RankingLojas({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[120px] bg-current/5 rounded" /></div>;
  }

  const maxFat = data.length > 0 ? data[0].faturamento : 0;

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Ranking de lojas</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-left opacity-50">
          <th className="pb-2">Loja</th><th className="pb-2 text-right">Faturamento</th>
          <th className="pb-2 text-right">Peças</th><th className="pb-2 text-right">Pedidos</th>
        </tr></thead>
        <tbody>
          {data.map(l => (
            <tr key={l.loja} className="border-t border-current/5">
              <td className="py-1.5">{l.loja}</td>
              <td className={`py-1.5 text-right font-medium ${l.faturamento === maxFat ? 'text-[#1D9E75]' : ''}`}>
                {formatBRL(l.faturamento)}
              </td>
              <td className="py-1.5 text-right">{formatNumero(l.pecas)}</td>
              <td className="py-1.5 text-right">{formatNumero(l.pedidos)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
