'use client';

import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip,
} from 'chart.js';
import type { VendaDia } from '../types';
import { formatBRLCurto, formatDataCurta } from '../lib/date-utils';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface Props {
  atual: VendaDia[];
  anterior: VendaDia[];
  loading: boolean;
}

export function GraficoVendas({ atual, anterior, loading }: Props) {
  // chartData/options memoizados — Chart.js re-pinta o canvas a cada
  // novo objeto. Sem useMemo, mudanças de prop não relacionadas (ex:
  // configOpen no parent) provocavam re-pintura desnecessária.
  const chartData = useMemo(() => {
    const labels = atual.map(d => formatDataCurta(d.data));
    const dataAtual = atual.map(d => d.faturamento);
    const dataAnterior = anterior.map(d => d.faturamento);
    while (dataAnterior.length < dataAtual.length) dataAnterior.push(0);
    return {
      labels,
      datasets: [
        {
          label: 'Período atual',
          data: dataAtual,
          backgroundColor: '#378ADD',
          borderRadius: 3,
          barPercentage: 0.6,
        },
        {
          label: 'Período anterior',
          data: dataAnterior,
          backgroundColor: 'rgba(55,138,221,0.25)',
          borderRadius: 3,
          barPercentage: 0.6,
        },
      ],
    };
  }, [atual, anterior]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          label: (ctx: any) =>
            `${ctx.dataset.label}: ${formatBRLCurto(ctx.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (value: string | number) => formatBRLCurto(Number(value)),
          font: { size: 9 },
          color: '#9ca3af',
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      x: {
        ticks: { font: { size: 8 }, color: '#9ca3af', maxRotation: 45 },
        grid: { display: false },
      },
    },
  }), []);

  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[160px] bg-current/5 rounded" /></div>;
  }

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Vendas por dia</h3>
      <div style={{ height: 130 }}>
        <Bar data={chartData} options={options} />
      </div>
      <div className="flex gap-4 mt-2 text-[10px] opacity-50">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#378ADD]" /> Período atual</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#378ADD]/25" /> Período anterior</span>
      </div>
    </div>
  );
}
