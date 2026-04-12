'use client';

import type { KpisSecundarios as KpisData } from '../types';
import { formatBRL, formatNumero, formatDataCurta } from '../lib/date-utils';

interface Props {
  data: KpisData | null;
  loading: boolean;
}

function MiniCard({ label, valor, subtexto }: { label: string; valor: string; subtexto?: string }) {
  return (
    <div className="card-secondary p-3 rounded-lg">
      <p className="text-[9px] uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-sm font-medium">{valor}</p>
      {subtexto && <p className="text-[10px] opacity-40 mt-0.5">{subtexto}</p>}
    </div>
  );
}

function Skeleton() {
  return <div className="card-secondary p-3 rounded-lg animate-pulse"><div className="h-8 bg-current/5 rounded" /></div>;
}

export function KpisSecundarios({ data, loading }: Props) {
  if (loading || !data) {
    return <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">{[1,2,3,4,5,6].map(i => <Skeleton key={i} />)}</div>;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <MiniCard label="Média diária R$" valor={formatBRL(data.mediaDiariaRs)} />
      <MiniCard
        label="Melhor dia R$"
        valor={formatBRL(data.melhorDia.valor)}
        subtexto={data.melhorDia.data ? formatDataCurta(data.melhorDia.data) : undefined}
      />
      <MiniCard
        label="Projeção mês R$"
        valor={data.projecaoMesRs !== null ? formatBRL(data.projecaoMesRs) : '—'}
        subtexto={data.projecaoMesRs === null ? 'Período encerrado' : undefined}
      />
      <MiniCard label="Média diária peças" valor={formatNumero(Math.round(data.mediaDiariaPecas))} />
      <MiniCard
        label="Projeção mês peças"
        valor={data.projecaoMesPecas !== null ? formatNumero(Math.round(data.projecaoMesPecas)) : '—'}
        subtexto={data.projecaoMesPecas === null ? 'Período encerrado' : undefined}
      />
      <MiniCard
        label="Cancelamentos"
        valor={formatNumero(data.cancelamentos)}
        subtexto={`${formatBRL(data.valorCancelado)} cancelado`}
      />
    </div>
  );
}
