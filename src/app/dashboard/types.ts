/**
 * SITUAÇÕES TINY ERP — REFERÊNCIA COMPLETA
 *
 * IMPORTANTE: Não confundir com situacao_final do banco (usado pelo polling).
 * situacao_final=true no banco significa apenas que o polling parou de monitorar.
 * Aqui mapeamos o significado de negócio de cada situação.
 *
 * Entram no faturamento (pagamento confirmado): 1, 3, 4, 5, 6, 7, 9
 * Cancelamentos: 2
 * Aguardando pagamento (não contam): 0, 8
 */

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

// Mapeamento completo de todas as situações da Tiny ERP
// Mantido completo mesmo que algumas situações não existam no banco hoje
// para garantir que pedidos futuros sejam tratados corretamente
export const SITUACAO_LABELS: Record<number, string> = {
  0: 'Aberto',
  1: 'Aprovado',
  2: 'Cancelado',
  3: 'Preparando',
  4: 'Faturado',
  5: 'Pronto para envio',
  6: 'Entregue',
  7: 'Enviado',
  8: 'Dados incompletos',
  9: 'Não entregue',
};

// Situações que entram no faturamento (pedido foi pago)
// 0 (Aberto) e 8 (Dados incompletos) NÃO entram — pagamento não confirmado
export const SITUACOES_APROVADAS = [1, 3, 4, 5, 6, 7, 9];

// Situações de cancelamento
export const SITUACOES_CANCELADAS = [2];

// Situações que ainda estão em andamento (não finalizaram)
// Usado para análises de pipeline/funil
export const SITUACOES_EM_ANDAMENTO = [0, 1, 3, 4, 5, 7, 8];

// Situações finais (pedido encerrado — não muda mais)
// IMPORTANTE: este array é para o DASHBOARD apenas
// O polling usa situacao_final=true no banco (apenas 2 e 6)
export const SITUACOES_FINAIS_DASH = [2, 6, 9];

export const MARKETPLACE_CORES: Record<string, string> = {
  'Mercado Livre': '#378ADD',
  'Shopee': '#EF9F27',
  'TikTok Shop': '#1D9E75',
  'Shein': '#D4537E',
};

// ============================================================
// RPC RETURN TYPES — espelham assinaturas da migration 020
// ============================================================

export interface DashboardKpisHero {
  faturamento: number;
  pedidos: number;
  pecas: number;
  ticket: number;
  cancelamentos: number;
  valor_cancelado: number;
  melhor_dia: string | null;
  melhor_dia_valor: number;
  media_diaria: number;
  dias_com_venda: number;
}

export interface DashboardVendasPorDia {
  data_pedido: string;
  faturamento: number;
  pedidos: number;
  cancelamentos: number;
  fat_cancelado: number;
  pecas: number;
  ticket_medio: number;
}

export interface DashboardTopSku {
  sku_pai: string;
  faturamento: number;
  pecas: number;
  pedidos: number;
  variacoes: string[];
}

export interface DashboardRankingLoja {
  ecommerce_nome: string;
  nome_loja: string;
  marketplace: string;
  faturamento: number;
  pedidos: number;
  pecas: number;
  ticket: number;
  cancelamentos: number;
  taxa_cancelamento: number;
}

export interface DashboardMarketplace {
  marketplace: string;
  faturamento: number;
  pedidos: number;
  percentual: number;
}

export interface DashboardHeatmapHora {
  dia_semana: number;
  hora: number;
  contagem: number;
  faturamento: number;
}

export interface DashboardKpisSecundarios {
  faturamento_bruto: number;
  faturamento_liquido: number;
  valor_desconto: number;
  valor_frete: number;
  percentual_desconto: number;
  percentual_frete: number;
  taxa_cancelamento: number;
  faturamento_cancelado: number;
}

export interface DashboardComparativoPeriodo {
  nome: string;
  date_range: string;
  valor: number;
  valor_comparado: number;
  variacao: number;
}
