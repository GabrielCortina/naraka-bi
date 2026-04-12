'use client';

import type { HeatmapCell } from '../types';

interface Props {
  data: HeatmapCell[];
  loading: boolean;
}

const HORAS = Array.from({ length: 13 }, (_, i) => i + 8); // 8h-20h
const DIAS_GRID = [0, 1, 2, 3, 4, 5, 6]; // Dom-Sáb
const TONS = ['#E6F1FB', '#B5D4F4', '#85B7EB', '#378ADD', '#185FA5', '#0C447C'];

const DIAS_ABREV: Record<number, string> = {
  0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb',
};

const DIAS_EXTENSO: Record<number, string> = {
  0: 'Domingo', 1: 'Segunda-feira', 2: 'Terça-feira', 3: 'Quarta-feira',
  4: 'Quinta-feira', 5: 'Sexta-feira', 6: 'Sábado',
};

function corPorIntensidade(valor: number, max: number): string {
  if (max === 0 || valor === 0) return TONS[0];
  const idx = Math.min(Math.floor((valor / max) * (TONS.length - 1)), TONS.length - 1);
  return TONS[idx];
}

export function HeatmapHorarios({ data, loading }: Props) {
  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[280px] bg-current/5 rounded" /></div>;
  }

  // Mapa rápido: "dia-hora" -> total
  const mapa = new Map<string, number>();
  let maxVal = 0;
  for (const cell of data) {
    const key = `${cell.diaSemana}-${cell.hora}`;
    mapa.set(key, cell.totalPedidos);
    if (cell.totalPedidos > maxVal) maxVal = cell.totalPedidos;
  }

  // KPIs: calcular médias por dia e totais por hora
  const totalPorDia = new Map<number, number>();
  const totalPorHora = new Map<number, number>();

  for (const cell of data) {
    // Contar total por dia da semana
    totalPorDia.set(cell.diaSemana, (totalPorDia.get(cell.diaSemana) || 0) + cell.totalPedidos);

    // Contar horas apenas entre 8h e 20h
    if (cell.hora >= 8 && cell.hora <= 20) {
      totalPorHora.set(cell.hora, (totalPorHora.get(cell.hora) || 0) + cell.totalPedidos);
    }
  }

  // Para média, contar quantas ocorrências de cada dia temos (estimativa)
  const totalDias = data.length > 0
    ? Math.max(1, Math.ceil(Array.from(totalPorDia.values()).reduce((s, v) => s + v, 0) / Math.max(totalPorDia.size, 1) / 10))
    : 1;

  const diasOrdenados = Array.from(totalPorDia.entries()).sort((a, b) => b[1] - a[1]);
  const horasOrdenadas = Array.from(totalPorHora.entries()).sort((a, b) => b[1] - a[1]);
  const horasFiltradasAsc = Array.from(totalPorHora.entries())
    .filter(([h]) => h >= 8)
    .sort((a, b) => a[1] - b[1]);

  const melhorDia = diasOrdenados[0];
  const piorDia = diasOrdenados[diasOrdenados.length - 1];
  const horaPico = horasOrdenadas[0];
  const horaFraca = horasFiltradasAsc[0];

  const insights = [
    {
      label: 'MELHOR DIA',
      valor: melhorDia ? DIAS_EXTENSO[melhorDia[0]] : '—',
      sub: melhorDia ? `média de ${Math.round(melhorDia[1] / totalDias)} pedidos/dia` : '',
      cor: melhorDia ? '#1D9E75' : '#9ca3af',
    },
    {
      label: 'PIOR DIA',
      valor: piorDia ? DIAS_EXTENSO[piorDia[0]] : '—',
      sub: piorDia ? `média de ${Math.round(piorDia[1] / totalDias)} pedidos/dia` : '',
      cor: piorDia ? '#E24B4A' : '#9ca3af',
    },
    {
      label: 'HORÁRIO DE PICO',
      valor: horaPico ? `${horaPico[0]}h` : '—',
      sub: horaPico ? `${horaPico[1]} pedidos nessa faixa` : '',
      cor: horaPico ? '#378ADD' : '#9ca3af',
    },
    {
      label: 'HORÁRIO MAIS FRACO',
      valor: horaFraca ? `${horaFraca[0]}h` : '—',
      sub: horaFraca ? `${horaFraca[1]} pedidos nessa faixa` : '',
      cor: horaFraca ? '#EF9F27' : '#9ca3af',
    },
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
          {DIAS_GRID.map(dia => (
            <div key={`row-${dia}`} className="contents">
              <div className="text-[9px] opacity-50 flex items-center">{DIAS_ABREV[dia]}</div>
              {HORAS.map(hora => {
                const val = mapa.get(`${dia}-${hora}`) || 0;
                return (
                  <div
                    key={`${dia}-${hora}`}
                    className="aspect-square rounded-sm"
                    style={{ backgroundColor: corPorIntensidade(val, maxVal) }}
                    title={`${DIAS_EXTENSO[dia]} ${hora}h: ${val} pedidos`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legenda de intensidade */}
      <div className="flex items-center gap-1 mt-2 text-[8px] opacity-40">
        <span>menos</span>
        {TONS.map((c, i) => (
          <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>mais</span>
      </div>

      {/* Divisor */}
      <div className="my-2.5" style={{ borderBottom: '.5px solid var(--bord, rgba(128,128,128,0.15))' }} />

      {/* 4 KPIs insight */}
      <div className="flex flex-col" style={{ gap: 6 }}>
        {insights.map(kpi => (
          <div
            key={kpi.label}
            className="flex items-center justify-between rounded-[7px]"
            style={{ padding: '9px 11px', background: 'var(--bg3, rgba(128,128,128,0.08))' }}
          >
            <div className="flex flex-col" style={{ gap: 2 }}>
              <p className="text-[9px] font-medium uppercase tracking-wider"
                style={{ letterSpacing: '0.06em', color: 'var(--txt3, #6b7280)' }}>
                {kpi.label}
              </p>
              <p className="text-[9px]" style={{ color: 'var(--txt3, #6b7280)' }}>{kpi.sub}</p>
            </div>
            <span className="text-sm font-medium shrink-0" style={{ color: kpi.cor }}>
              {kpi.valor}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
