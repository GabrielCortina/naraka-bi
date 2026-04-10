// Tipos do banco de dados Supabase

export interface TinyTokenRow {
  id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string; // timestamp
  created_at: string;
  updated_at: string;
}

export interface PollingStateRow {
  id: number;
  ultima_verificacao: string; // timestamp
  pedidos_processados: number;
  status: 'idle' | 'running' | 'error';
  erro_mensagem: string | null;
  updated_at: string;
}

export interface PedidoRow {
  id: number; // ID do Tiny
  numero_pedido: string;
  id_nota_fiscal: number | null;
  data_faturamento: string | null;
  valor_total_produtos: number;
  valor_total_pedido: number;
  valor_desconto: number;
  valor_frete: number;
  valor_outras_despesas: number;
  situacao: number;
  data_pedido: string;
  data_entrega: string | null;
  data_prevista: string | null;
  data_envio: string | null;
  observacoes: string | null;
  observacoes_internas: string | null;
  numero_ordem_compra: string | null;
  origem_pedido: number;
  // Cliente (desnormalizado para queries rápidas de BI)
  cliente_id: number | null;
  cliente_nome: string | null;
  cliente_cpf_cnpj: string | null;
  cliente_email: string | null;
  // E-commerce
  ecommerce_id: number | null;
  ecommerce_nome: string | null;
  numero_pedido_ecommerce: string | null;
  canal_venda: string | null;
  // Transportador
  transportador_id: number | null;
  transportador_nome: string | null;
  codigo_rastreamento: string | null;
  // Vendedor
  vendedor_id: number | null;
  vendedor_nome: string | null;
  // Pagamento
  forma_pagamento: string | null;
  meio_pagamento: string | null;
  // Controle
  raw_data: Record<string, unknown>; // JSON completo da API
  created_at: string;
  updated_at: string;
}

export interface PedidoItemRow {
  id: number; // autoincrement
  pedido_id: number; // FK para pedidos.id
  produto_id: number;
  sku: string;
  descricao: string;
  tipo_produto: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  info_adicional: string | null;
  created_at: string;
}
