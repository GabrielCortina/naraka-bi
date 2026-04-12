'use client';

import type { ResumoHero } from '../types';
import { formatBRL, formatNumero, calcVariacao } from '../lib/date-utils';

interface Props {
  data: ResumoHero | null;
  loading: boolean;
}

function Badge({ valor, anterior }: { valor: number; anterior: number }) {
  const variacao = calcVariacao(valor, anterior);
  const positivo = variacao >= 0;
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
      positivo ? 'text-[#1D9E75] bg-[#1D9E75]/10' : 'text-[#E24B4A] bg-[#E24B4A]/10'
    }`}>
      {positivo ? '▲' : '▼'} {Math.abs(variacao).toFixed(1)}%
    </span>
  );
}

function HeroCard({ label, valor, valorFormatado, anterior, anteriorFormatado }: {
  label: string;
  valor: number;
  valorFormatado: string;
  anterior: number;
  anteriorFormatado: string;
}) {
  return (
    <div className="card p-4 rounded-lg">
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg font-medium">{valorFormatado}</span>
        <Badge valor={valor} anterior={anterior} />
      </div>
      <p className="text-[10px] opacity-40">vs anterior: {anteriorFormatado}</p>
    </div>
  );
}

function Skeleton() {
  return <div className="card p-4 rounded-lg animate-pulse"><div className="h-12 bg-current/5 rounded" /></div>;
}

export function KpisHero({ data, loading }: Props) {
  if (loading || !data) {
    return <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{[1,2,3,4].map(i => <Skeleton key={i} />)}</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <HeroCard label="Faturamento" valor={data.faturamento} valorFormatado={formatBRL(data.faturamento)}
        anterior={data.faturamentoAnterior} anteriorFormatado={formatBRL(data.faturamentoAnterior)} />
      <HeroCard label="Pedidos aprovados" valor={data.pedidos} valorFormatado={formatNumero(data.pedidos)}
        anterior={data.pedidosAnterior} anteriorFormatado={formatNumero(data.pedidosAnterior)} />
      <HeroCard label="Ticket médio" valor={data.ticketMedio} valorFormatado={formatBRL(data.ticketMedio)}
        anterior={data.ticketMedioAnterior} anteriorFormatado={formatBRL(data.ticketMedioAnterior)} />
      <HeroCard label="Peças vendidas" valor={data.pecasVendidas} valorFormatado={formatNumero(data.pecasVendidas)}
        anterior={data.pecasAnterior} anteriorFormatado={formatNumero(data.pecasAnterior)} />
    </div>
  );
}
