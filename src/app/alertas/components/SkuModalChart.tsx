'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  Filler, Tooltip, type Chart,
} from 'chart.js';
import type { SeriePoint, AlteracaoItem } from '../hooks/useSkuModal';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

interface Props {
  serie: SeriePoint[];
  alteracoes: AlteracaoItem[];
  metrica: 'quantidade' | 'faturamento';
  onMetricaChange: (m: 'quantidade' | 'faturamento') => void;
  loading: boolean;
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function fmtLabel(val: string): string {
  // Labels horários ("14h") passam direto
  if (/^\d{1,2}h$/.test(val)) return val;
  // Data "YYYY-MM-DD" → "DD/MM"
  const parts = val.split('-');
  if (parts.length === 3) {
    return `${pad2(Number(parts[2]))}/${pad2(Number(parts[1]))}`;
  }
  return val;
}

interface MarkerLayout {
  x: number;       // pixels dentro do chart
  topY: number;
  bottomY: number;
  alteracao: AlteracaoItem;
}

export function SkuModalChart({ serie, alteracoes, metrica, onMetricaChange, loading }: Props) {
  const chartRef = useRef<Chart<'line'> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [markers, setMarkers] = useState<MarkerLayout[]>([]);
  const [tooltipIdx, setTooltipIdx] = useState<number | null>(null);

  const labels = useMemo(() => serie.map(s => s.data), [serie]);
  const valores = useMemo(
    () => serie.map(s => metrica === 'quantidade' ? s.quantidade : s.faturamento),
    [serie, metrica],
  );

  // Data das alterações que estão dentro do range da série
  const alteracoesNoRange = useMemo(() => {
    if (labels.length === 0) return [];
    const set = new Set(labels);
    return alteracoes.filter(a => set.has(a.dataAlteracao));
  }, [alteracoes, labels]);

  // Plugin para desenhar linhas verticais pontilhadas nos pontos de alteração
  const markersPlugin = useMemo(() => ({
    id: 'sku-alteracoes-markers',
    afterDatasetsDraw(chart: Chart) {
      const ctx = chart.ctx;
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return;
      ctx.save();
      alteracoesNoRange.forEach(a => {
        const idx = labels.indexOf(a.dataAlteracao);
        if (idx < 0) return;
        const xPos = xScale.getPixelForValue(idx);
        if (!Number.isFinite(xPos)) return;
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#D85A30';
        ctx.lineWidth = 1.25;
        ctx.moveTo(xPos, yScale.top + 12);
        ctx.lineTo(xPos, yScale.bottom);
        ctx.stroke();
      });
      ctx.restore();
      ctx.setLineDash([]);
    },
  }), [alteracoesNoRange, labels]);

  // Recalcula posições dos markers após o chart renderizar
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || alteracoesNoRange.length === 0) {
      setMarkers([]);
      return;
    }
    const xScale = chart.scales.x;
    const yScale = chart.scales.y;
    if (!xScale || !yScale) return;

    const layouts: MarkerLayout[] = alteracoesNoRange
      .map(a => {
        const idx = labels.indexOf(a.dataAlteracao);
        if (idx < 0) return null;
        const x = xScale.getPixelForValue(idx);
        if (!Number.isFinite(x)) return null;
        return { x, topY: yScale.top, bottomY: yScale.bottom, alteracao: a };
      })
      .filter((m): m is MarkerLayout => m !== null);

    setMarkers(layouts);
  }, [serie, alteracoesNoRange, labels, metrica]);

  const data = {
    labels,
    datasets: [{
      label: metrica === 'quantidade' ? 'Peças' : 'Faturamento',
      data: valores,
      borderColor: '#1D9E75',
      backgroundColor: (ctx: { chart: Chart }) => {
        const canvas = ctx.chart.ctx;
        const gradient = canvas.createLinearGradient(0, 0, 0, ctx.chart.height);
        gradient.addColorStop(0, 'rgba(29, 158, 117, 0.35)');
        gradient.addColorStop(1, 'rgba(29, 158, 117, 0.02)');
        return gradient;
      },
      borderWidth: 2.5,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: '#1D9E75',
      pointHoverBorderColor: '#fff',
      pointHoverBorderWidth: 2,
      fill: true,
      tension: 0.3,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: {
      x: {
        ticks: {
          color: 'rgb(150,150,150)',
          font: { size: 10 },
          callback: (_: unknown, index: number) => {
            if (serie.length === 0) return '';
            const step = Math.max(1, Math.floor(serie.length / 6));
            const isHourly = /^\d{1,2}h$/.test(labels[0] ?? '');
            // Modo diário: última label vira "Hoje"; modo horário mostra a hora normal
            if (!isHourly && index === serie.length - 1) return 'Hoje';
            return index % step === 0 ? fmtLabel(labels[index]) : '';
          },
          maxRotation: 0,
          autoSkip: false,
        },
        grid: { display: false },
        border: { display: false },
      },
      y: {
        ticks: {
          color: 'rgb(150,150,150)',
          font: { size: 10 },
          callback: (v: string | number) => {
            const n = typeof v === 'number' ? v : Number(v);
            if (metrica === 'faturamento') {
              return formatBRL(n).replace('R$\u00A0', 'R$');
            }
            return n.toLocaleString('pt-BR');
          },
        },
        grid: {
          color: 'rgba(128,128,128,0.1)',
        },
        border: { display: false },
        beginAtZero: true,
      },
    },
    plugins: {
      tooltip: {
        backgroundColor: 'rgba(15,17,23,0.95)',
        titleColor: '#fff',
        bodyColor: '#fff',
        padding: 10,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        callbacks: {
          title: (items: { dataIndex: number }[]) => fmtLabel(labels[items[0].dataIndex]),
          label: (ctx: { parsed: { y: number | null } }) => {
            const y = ctx.parsed.y ?? 0;
            return metrica === 'faturamento'
              ? formatBRL(y)
              : `${y.toLocaleString('pt-BR')} peças`;
          },
        },
      },
    },
  };

  if (loading) {
    return (
      <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5 mb-5">
        <div className="h-[280px] animate-pulse bg-current/5 rounded" />
      </div>
    );
  }

  return (
    <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5 mb-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium opacity-70">VENDAS POR DIA</h3>
        <div className="flex items-center gap-3">
          {/* Toggle métrica */}
          <div className="flex gap-1">
            {([['quantidade', 'Peças'], ['faturamento', 'Fat.']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => onMetricaChange(key)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  metrica === key
                    ? 'bg-[#378ADD] text-white'
                    : 'border border-current/10 hover:border-current/30'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Legenda */}
          <div className="flex items-center gap-3 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-[2px] bg-[#1D9E75]" /> Vendas
            </span>
            {alteracoesNoRange.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-[2px] bg-[#D85A30]" style={{ borderTop: '1px dashed #D85A30', backgroundColor: 'transparent' }} />
                Alteração
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Chart + overlay de ícones */}
      <div className="relative" ref={wrapRef} style={{ height: 280 }}>
        <Line
          ref={chartRef}
          data={data}
          options={options}
          plugins={[markersPlugin]}
        />
        {/* Overlay de ícones ⚙ */}
        <div className="absolute inset-0 pointer-events-none">
          {markers.map((m, i) => (
            <div
              key={m.alteracao.id}
              className="absolute pointer-events-auto"
              style={{
                left: m.x - 10,
                top: m.topY - 2,
              }}
              onMouseEnter={() => setTooltipIdx(i)}
              onMouseLeave={() => setTooltipIdx(null)}
            >
              <div
                className="w-5 h-5 rounded flex items-center justify-center text-white text-[11px] cursor-help"
                style={{ background: '#D85A30' }}
              >
                ⚙
              </div>
              {tooltipIdx === i && (
                <div
                  className="absolute z-10 top-6 left-1/2 -translate-x-1/2 text-[10px] px-2 py-1.5 rounded whitespace-nowrap shadow-lg border border-current/10 dark:bg-[#0f1117] bg-white"
                  style={{ minWidth: 140 }}
                >
                  <div className="font-medium mb-0.5">
                    {fmtLabel(m.alteracao.dataAlteracao)} · {m.alteracao.tipoAlteracao}
                  </div>
                  {(m.alteracao.valorAntes || m.alteracao.valorDepois) && (
                    <div className="opacity-70">
                      {m.alteracao.valorAntes ?? '—'} → {m.alteracao.valorDepois ?? '—'}
                    </div>
                  )}
                  {m.alteracao.motivo && (
                    <div className="opacity-50 mt-0.5">{m.alteracao.motivo}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {serie.length === 0 && (
        <p className="text-center text-xs text-gray-500 py-4">Sem dados no período</p>
      )}
    </div>
  );
}
