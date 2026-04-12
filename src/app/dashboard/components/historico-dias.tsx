'use client';

import type { HistoricoDia } from '../types';
import { formatBRL, formatNumero, formatDataCurta } from '../lib/date-utils';

interface Props {
  data: HistoricoDia[];
  loading: boolean;
}

export function HistoricoDias({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[120px] bg-current/5 rounded" /></div>;
  }

  if (data.length === 0) {
    return (
      <div className="card p-4 rounded-lg">
        <h3 className="text-xs font-medium mb-3 opacity-70">Histórico por dia</h3>
        <p className="text-xs opacity-40">Nenhum dado para o período selecionado</p>
      </div>
    );
  }

  const maxFat = Math.max(...data.map(d => d.faturamento));
  const minFat = Math.min(...data.filter(d => d.faturamento > 0).map(d => d.faturamento));

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Histórico por dia</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left opacity-50">
            <th className="pb-2">Data</th>
            <th className="pb-2 text-right">Faturamento</th>
            <th className="pb-2 text-right">Pedidos</th>
            <th className="pb-2 text-right">Peças</th>
            <th className="pb-2 text-right">Ticket médio</th>
            <th className="pb-2 text-right">Cancel.</th>
            <th className="pb-2 text-right">Fat. cancel.</th>
          </tr></thead>
          <tbody>
            {data.map(d => (
              <tr key={d.data} className="border-t border-current/5">
                <td className="py-1.5">{formatDataCurta(d.data)}</td>
                <td className={`py-1.5 text-right font-medium ${
                  d.faturamento === maxFat ? 'text-[#1D9E75]' :
                  d.faturamento === minFat && d.faturamento > 0 ? 'text-[#E24B4A]' : ''
                }`}>
                  {formatBRL(d.faturamento)}
                </td>
                <td className="py-1.5 text-right">{formatNumero(d.pedidos)}</td>
                <td className="py-1.5 text-right">{formatNumero(d.pecas)}</td>
                <td className="py-1.5 text-right">{formatBRL(d.ticketMedio)}</td>
                <td className="py-1.5 text-right">{d.cancelamentos > 0 ? formatNumero(d.cancelamentos) : '—'}</td>
                <td className="py-1.5 text-right opacity-60">{d.fatCancelado > 0 ? formatBRL(d.fatCancelado) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
