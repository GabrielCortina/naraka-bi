// Tipos do Dashboard de Vendas

export type PeriodFilter =
  | 'hoje'
  | 'ontem'
  | '7dias'
  | '15dias'
  | 'mes_atual'
  | 'mes_anterior'
  | 'personalizado';

export interface DateRange {
  start: string; // yyyy-MM-dd
  end: string;   // yyyy-MM-dd
}

export interface ResumoHero {
  faturamento: number;
  pedidos: number;
  ticketMedio: number;
  pecasVendidas: number;
  faturamentoAnterior: number;
  pedidosAnterior: number;
  ticketMedioAnterior: number;
  pecasAnterior: number;
}

export interface KpisSecundarios {
  mediaDiariaRs: number;
  melhorDia: { data: string; valor: number };
  projecaoMesRs: number | null;
  mediaDiariaPecas: number;
  projecaoMesPecas: number | null;
  cancelamentos: number;
  valorCancelado: number;
}

export interface VendaDia {
  data: string;
  faturamento: number;
  pedidos: number;
  pecas: number;
}

export interface SkuPaiAgrupado {
  skuPai: string;
  variacoes: string[];
  faturamentoTotal: number;
  quantidadeTotal: number;
}

export interface SkuDetalhe {
  sku: string;
  descricao: string;
  quantidade: number;
  faturamento: number;
  percentual: number;
}

export interface LojaRanking {
  loja: string;
  faturamento: number;
  pecas: number;
  pedidos: number;
}

export interface MarketplaceData {
  marketplace: string;
  faturamento: number;
  percentual: number;
  cor: string;
}

export interface HeatmapCell {
  diaSemana: number; // 0=Dom, 6=Sáb
  hora: number;      // 0-23
  totalPedidos: number;
}

export interface ComparativoPeriodo {
  nome: string;
  dateRange: string;
  valor: number;
  valorComparado: number;
  variacao: number;
}

export interface HistoricoDia {
  data: string;
  faturamento: number;
  pedidos: number;
  pecas: number;
  ticketMedio: number;
  cancelamentos: number;
  fatCancelado: number;
}

export const LOJAS = [
  'NARAKA MELI',
  'OXEAN MELI',
  'ELIS MELI',
  'NARAKA TIKTOK',
  'OXEAN SHOPEE',
  'JOY SHOPEE',
  'ELIS SHOPEE',
  'ELIS SHEIN',
] as const;

export const SITUACOES_APROVADAS = [1, 3, 4, 5, 7, 9];
export const SITUACOES_CANCELADAS = [2, 6];

export const MARKETPLACE_CORES: Record<string, string> = {
  'Mercado Livre': '#378ADD',
  'Shopee': '#EF9F27',
  'TikTok Shop': '#1D9E75',
  'Shein': '#D4537E',
};
