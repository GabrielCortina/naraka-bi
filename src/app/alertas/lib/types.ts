export type PresetPeriodo = 'hoje' | 'ontem' | '7d' | '15d' | 'mes';

export interface Periodo {
  inicio: string; // yyyy-MM-dd
  fim: string;
}

export interface PeriodosCalculados {
  periodoA: Periodo;
  periodoB: Periodo;
  label: string;
}

export interface BreakdownLoja {
  loja: string;
  delta_pct: number | null;
  delta_pecas: number;
  delta_faturamento: number;
}

export interface Alerta {
  sku_pai: string;
  tipo: 'PICO' | 'QUEDA';
  severidade: 'ALTA' | 'MODERADA' | 'LEVE';
  periodo_a_pecas: number;
  periodo_b_pecas: number;
  delta_pecas: number;
  periodo_a_faturamento: number;
  periodo_b_faturamento: number;
  delta_faturamento: number;
  variacao_pct: number;
  score: number;
  lojas_afetadas: string[];
  breakdown_lojas: BreakdownLoja[];
  is_pinado: boolean;
}

export interface AlertaResumo {
  tipo: string;
  severidade: string;
  quantidade: number;
}

export interface PinadoStatus {
  sku_pai: string;
  tipo: 'PICO' | 'QUEDA' | 'ESTAVEL';
  severidade: 'ALTA' | 'MODERADA' | 'LEVE';
  variacao_pct: number;
  delta_pecas: number;
  delta_faturamento: number;
}
