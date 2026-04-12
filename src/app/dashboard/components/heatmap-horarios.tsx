'use client';

import type { HeatmapCell } from '../types';
import { nomeDiaSemana } from '../lib/date-utils';

interface Props {
  data: HeatmapCell[];
  loading: boolean;
}

const HORAS = Array.from({ length: 13 }, (_, i) => i + 8); // 8h-20h
const DIAS = [0, 1, 2, 3, 4, 5, 6]; // Dom-Sáb
const TONS = ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD', '#185FA5', '#0C447C'];

function corPorIntensidade(valor: number, max: number): string {
  if (max === 0 || valor === 0) return TONS[0];
  const idx = Math.min(Math.floor((valor / max) * (TONS.length - 1)), TONS.length - 1);
  return TONS[idx];
}

export function HeatmapHorarios({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[180px] bg-current/5 rounded" /></div>;
  }

  // Mapa rápido: "dia-hora" -> total
  const mapa = new Map<string, number>();
  let maxVal = 0;
  for (const cell of data) {
    const key = `${cell.diaSemana}-${cell.hora}`;
    mapa.set(key, cell.totalPedidos);
    if (cell.totalPedidos > maxVal) maxVal = cell.totalPedidos;
  }

  // KPIs insight
  const porDia = new Map<number, number>();
  const porHora = new Map<number, number>();
  for (const cell of data) {
    porDia.set(cell.diaSemana, (porDia.get(cell.diaSemana) || 0) + cell.totalPedidos);
    if (cell.hora >= 8 && cell.hora <= 20) {
      porHora.set(cell.hora, (porHora.get(cell.hora) || 0) + cell.totalPedidos);
    }
  }

  const melhorDia = Array.from(porDia.entries()).sort((a, b) => b[1] - a[1])[0];
  const piorDia = Array.from(porDia.entries()).sort((a, b) => a[1] - b[1])[0];
  const horaPico = Array.from(porHora.entries()).sort((a, b) => b[1] - a[1])[0];
  const horaFraca = Array.from(porHora.entries()).filter(([h]) => h >= 8).sort((a, b) => a[1] - b[1])[0];

  const insights = [
    { label: 'Melhor dia', valor: melhorDia ? nomeDiaSemana(melhorDia[0]) : '—', sub: melhorDia ? `${melhorDia[1]} pedidos` : '', cor: '#1D9E75' },
    { label: 'Pior dia', valor: piorDia ? nomeDiaSemana(piorDia[0]) : '—', sub: piorDia ? `${piorDia[1]} pedidos` : '', cor: '#E24B4A' },
    { label: 'Horário de pico', valor: horaPico ? `${horaPico[0]}h` : '—', sub: horaPico ? `${horaPico[1]} pedidos` : '', cor: '#378ADD' },
    { label: 'Horário mais fraco', valor: horaFraca ? `${horaFraca[0]}h` : '—', sub: horaFraca ? `${horaFraca[1]} pedidos` : '', cor: '#EF9F27' },
  ];

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Heatmap de horários</h3>

      {/* Grade */}
      <div className="overflow-x-auto">
        <div className="grid gap-px" style={{ gridTemplateColumns: `40px repeat(${HORAS.length}, 1fr)` }}>
          {/* Header horas */}
          <div />
          {HORAS.map(h => (
            <div key={h} className="text-center text-[8px] opacity-40 pb-1">{h}h</div>
          ))}

          {/* Linhas por dia */}
          {DIAS.map(dia => (
            <>
              <div key={`label-${dia}`} className="text-[9px] opacity-50 flex items-center">{nomeDiaSemana(dia)}</div>
              {HORAS.map(hora => {
                const val = mapa.get(`${dia}-${hora}`) || 0;
                return (
                  <div
                    key={`${dia}-${hora}`}
                    className="aspect-square rounded-sm"
                    style={{ backgroundColor: corPorIntensidade(val, maxVal) }}
                    title={`${nomeDiaSemana(dia)} ${hora}h: ${val} pedidos`}
                  />
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-1 mt-2 text-[8px] opacity-40">
        <span>menos</span>
        {TONS.map((c, i) => (
          <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>mais</span>
      </div>

      {/* KPIs insight */}
      <div className="mt-4 space-y-2">
        {insights.map(kpi => (
          <div key={kpi.label} className="flex items-center justify-between">
            <div>
              <p className="text-[10px] opacity-50">{kpi.label}</p>
              <p className="text-[9px] opacity-30">{kpi.sub}</p>
            </div>
            <span className="text-xs font-medium" style={{ color: kpi.cor }}>{kpi.valor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
