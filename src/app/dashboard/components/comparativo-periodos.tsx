'use client';

import type { ComparativoPeriodo } from '../types';
import { formatBRL } from '../lib/date-utils';

interface Props {
  data: ComparativoPeriodo[];
  loading: boolean;
}

function formatBadge(variacao: number, temDados: boolean) {
  if (!temDados) {
    return (
      <span className="text-[9px] font-medium py-px px-1.5 rounded"
        style={{ background: 'var(--bg3, rgba(128,128,128,0.1))', color: 'var(--txt3, #9ca3af)' }}>
        —
      </span>
    );
  }

  const capped = Math.min(Math.abs(variacao), 999);
  const positivo = variacao >= 0;
  const texto = capped >= 999 ? '+999%' : `${positivo ? '▲' : '▼'} ${capped.toFixed(1)}%`;

  return (
    <span className="text-[9px] font-medium py-px px-1.5 rounded"
      style={positivo
        ? { background: '#EAF3DE', color: '#3B6D11' }
        : { background: '#FCEBEB', color: '#A32D2D' }
      }>
      {texto}
    </span>
  );
}

function Linha({ item, isLast }: { item: ComparativoPeriodo; isLast: boolean }) {
  const temDados = item.valorComparado > 0;

  return (
    <div
      className="flex items-start justify-between"
      style={{
        padding: '10px 0',
        borderBottom: isLast ? 'none' : '.5px solid var(--bord, rgba(128,128,128,0.15))',
      }}
    >
      <div className="flex flex-col" style={{ gap: 3 }}>
        <p className="text-[11px]" style={{ color: 'var(--txt2, #9ca3af)' }}>{item.nome}</p>
        <p className="text-[9px]" style={{ color: 'var(--txt3, #6b7280)' }}>{item.dateRange}</p>
      </div>
      <div className="flex flex-col items-end shrink-0" style={{ gap: 3 }}>
        <p className="text-xs font-medium">{formatBRL(item.valor)}</p>
        {formatBadge(item.variacao, temDados)}
      </div>
    </div>
  );
}

export function ComparativoPeriodos({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[160px] bg-current/5 rounded" /></div>;
  }

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Comparativo período a período</h3>
      <div>
        {data.map((item, i) => (
          <Linha key={item.nome} item={item} isLast={i === data.length - 1} />
        ))}
      </div>
    </div>
  );
}
