'use client';

import type { Kpis, Tendencia } from '../hooks/useSkuModal';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  kpis: Kpis | null;
  tendencia: Tendencia | null;
  loading: boolean;
}

function variacao(atual: number, anterior: number): { label: string; color: string } {
  if (anterior === 0) {
    if (atual === 0) return { label: '—', color: 'text-gray-400' };
    return { label: 'novo', color: 'text-green-600 dark:text-green-400' };
  }
  const pct = ((atual - anterior) / anterior) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 5) return { label: 'estável', color: 'text-gray-400' };
  const sign = pct > 0 ? '+' : '';
  const color = pct > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400';
  return { label: `${sign}${pct.toFixed(1)}% vs ant`, color };
}

function KpiCard({ label, value, hint, hintColor }: { label: string; value: string; hint?: string; hintColor?: string }) {
  return (
    <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5">
      <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-medium leading-tight">{value}</p>
      {hint && <p className={`text-[11px] mt-1 ${hintColor ?? 'text-gray-400'}`}>{hint}</p>}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="h-[88px] bg-current/5 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

export function SkuModalKPIs({ kpis, tendencia, loading }: Props) {
  if (loading || !kpis) return <Skeleton />;

  const vVendas = variacao(kpis.vendas, kpis.vendasAnterior);
  const vFat    = variacao(kpis.faturamento, kpis.faturamentoAnterior);

  const tendLabel = (() => {
    if (!tendencia || tendencia.direcao === null || tendencia.dias === 0) {
      return { value: '—', hint: 'sem tendência', color: 'text-gray-400' };
    }
    const arrow = tendencia.direcao === 'alta' ? '↗' : '↘';
    const color = tendencia.direcao === 'alta'
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-500 dark:text-red-400';
    return {
      value: `${arrow} ${tendencia.dias} dias`,
      hint: tendencia.direcao === 'alta' ? 'alta consecutiva' : 'queda consecutiva',
      color,
    };
  })();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      <KpiCard
        label="Vendas"
        value={kpis.vendas.toLocaleString('pt-BR')}
        hint={vVendas.label}
        hintColor={vVendas.color}
      />
      <KpiCard
        label="Faturamento"
        value={formatBRL(kpis.faturamento)}
        hint={vFat.label}
        hintColor={vFat.color}
      />
      <KpiCard
        label="Ticket médio"
        value={formatBRL(kpis.ticketMedio)}
        hint="no período"
      />
      <KpiCard
        label="Tendência"
        value={tendLabel.value}
        hint={tendLabel.hint}
        hintColor={tendLabel.color}
      />
    </div>
  );
}
