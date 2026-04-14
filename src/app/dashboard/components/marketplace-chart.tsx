'use client';

import { useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import type { MarketplaceData } from '../types';
import { formatBRL } from '../lib/date-utils';

ChartJS.register(ArcElement, Tooltip);

interface Props {
  data: MarketplaceData[];
  loading: boolean;
}

export function MarketplaceChart({ data, loading }: Props) {
  // chartData/options memoizados — Chart.js re-pinta canvas a cada novo objeto.
  const chartData = useMemo(() => ({
    labels: data.map(d => d.marketplace),
    datasets: [{
      data: data.map(d => d.faturamento),
      backgroundColor: data.map(d => d.cor),
      borderWidth: 0,
    }],
  }), [data]);

  const options = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: { label?: string; parsed: number }) =>
            `${ctx.label}: ${formatBRL(ctx.parsed)}`,
        },
      },
    },
  }), []);

  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[140px] bg-current/5 rounded" /></div>;
  }

  if (data.length === 0) {
    return (
      <div className="card p-4 rounded-lg">
        <h3 className="text-xs font-medium mb-3 opacity-70">Vendas por marketplace</h3>
        <p className="text-xs opacity-40">Nenhum dado</p>
      </div>
    );
  }

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Vendas por marketplace</h3>
      <div style={{ height: 110 }}>
        <Doughnut data={chartData} options={options} />
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {data.map(d => (
          <span key={d.marketplace} className="flex items-center gap-1 text-[10px]">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.cor }} />
            {d.marketplace} {d.percentual.toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}
