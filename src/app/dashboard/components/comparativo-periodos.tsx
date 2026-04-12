'use client';

import type { ComparativoPeriodo } from '../types';
import { formatBRL } from '../lib/date-utils';

interface Props {
  data: ComparativoPeriodo[];
  loading: boolean;
}

function Linha({ item }: { item: ComparativoPeriodo }) {
  const positivo = item.variacao >= 0;
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-xs font-medium">{item.nome}</p>
        <p className="text-[10px] opacity-40">{item.dateRange}</p>
      </div>
      <div className="text-right">
        <p className="text-xs font-medium">{formatBRL(item.valor)}</p>
        <span className={`text-[10px] font-medium ${positivo ? 'text-[#1D9E75]' : 'text-[#E24B4A]'}`}>
          {positivo ? '▲' : '▼'} {Math.abs(item.variacao).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

export function ComparativoPeriodos({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[160px] bg-current/5 rounded" /></div>;
  }

  // Dividir em: semanas, meses, quinzena
  const semanas = data.filter(d => d.nome.includes('Semana'));
  const meses = data.filter(d => d.nome.includes('Mês'));
  const quinzenas = data.filter(d => d.nome.includes('Quinzena'));

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Comparativo período a período</h3>
      <div className="divide-y divide-current/5">
        {semanas.map(item => <Linha key={item.nome} item={item} />)}
        {meses.length > 0 && <div className="pt-1" />}
        {meses.map(item => <Linha key={item.nome} item={item} />)}
        {quinzenas.length > 0 && <div className="pt-1" />}
        {quinzenas.map(item => <Linha key={item.nome} item={item} />)}
      </div>
    </div>
  );
}
