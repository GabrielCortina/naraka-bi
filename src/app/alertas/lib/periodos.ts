import type { PresetPeriodo, PeriodosCalculados } from './types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtLabel(d: Date): string {
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
}

export function calcularPeriodos(preset: PresetPeriodo): PeriodosCalculados {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (preset) {
    case 'hoje': {
      const a = new Date(y, m, d);
      const b = new Date(y, m, d - 1);
      return {
        periodoA: { inicio: fmt(a), fim: fmt(a) },
        periodoB: { inicio: fmt(b), fim: fmt(b) },
        label: `${fmtLabel(a)} vs ${fmtLabel(b)}`,
      };
    }
    case 'ontem': {
      const a = new Date(y, m, d - 1);
      const b = new Date(y, m, d - 2);
      return {
        periodoA: { inicio: fmt(a), fim: fmt(a) },
        periodoB: { inicio: fmt(b), fim: fmt(b) },
        label: `${fmtLabel(a)} vs ${fmtLabel(b)}`,
      };
    }
    case '7d': {
      const aFim = new Date(y, m, d - 1);
      const aIni = new Date(y, m, d - 7);
      const bFim = new Date(y, m, d - 8);
      const bIni = new Date(y, m, d - 14);
      return {
        periodoA: { inicio: fmt(aIni), fim: fmt(aFim) },
        periodoB: { inicio: fmt(bIni), fim: fmt(bFim) },
        label: `${fmtLabel(aIni)}–${fmtLabel(aFim)} vs ${fmtLabel(bIni)}–${fmtLabel(bFim)}`,
      };
    }
    case '15d': {
      const aFim = new Date(y, m, d - 1);
      const aIni = new Date(y, m, d - 15);
      const bFim = new Date(y, m, d - 16);
      const bIni = new Date(y, m, d - 30);
      return {
        periodoA: { inicio: fmt(aIni), fim: fmt(aFim) },
        periodoB: { inicio: fmt(bIni), fim: fmt(bFim) },
        label: `${fmtLabel(aIni)}–${fmtLabel(aFim)} vs ${fmtLabel(bIni)}–${fmtLabel(bFim)}`,
      };
    }
    case 'mes': {
      const aIni = new Date(y, m, 1);
      const aFim = new Date(y, m, d - 1);
      const bIni = new Date(y, m - 1, 1);
      const bFim = new Date(y, m - 1, d - 1);
      return {
        periodoA: { inicio: fmt(aIni), fim: fmt(aFim) },
        periodoB: { inicio: fmt(bIni), fim: fmt(bFim) },
        label: `${fmtLabel(aIni)}–${fmtLabel(aFim)} vs ${fmtLabel(bIni)}–${fmtLabel(bFim)}`,
      };
    }
  }
}
