// Tipos da API Tiny ERP v3

export const SITUACAO_PEDIDO = {
  DADOS_INCOMPLETOS: 8,
  ABERTA: 0,
  APROVADA: 3,
  PREPARANDO_ENVIO: 4,
  FATURADA: 1,
  PRONTO_ENVIO: 7,
  ENVIADA: 5,
  ENTREGUE: 6,
  CANCELADA: 2,
  NAO_ENTREGUE: 9,
} as const;

export const SITUACAO_LABELS: Record<number, string> = {
  8: 'Dados Incompletos',
  0: 'Aberta',
  3: 'Aprovada',
  4: 'Preparando Envio',
  1: 'Faturada',
  7: 'Pronto Envio',
  5: 'Enviada',
  6: 'Entregue',
  2: 'Cancelada',
  9: 'Não Entregue',
};

export interface TinyTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

// Resposta da listagem de pedidos
export interface TinyPedidoListItem {
  id: number;
  situacao: number;
  numeroPedido: string;
  ecommerce: TinyEcommerce | null;
  dataCriacao: string;
  dataPrevista: string | null;
  cliente: { id: number; nome: string } | null;
  valor: number;
  vendedor: { id: number; nome: string } | null;
  transportador: { id: number; nome: string } | null;
  origemPedido: number;
}

export interface TinyPedidoListResponse {
  itens: TinyPedidoListItem[];
  paginacao: {
    limit: number;
    offset: number;
    total: number;
  };
}

// Pedido completo (GET /pedidos/{id})
export interface TinyPedidoFull {
  id: number;
  numeroPedido: string;
  idNotaFiscal: number | null;
  dataFaturamento: string | null;
  valorTotalProdutos: number;
  valorTotalPedido: number;
  valorDesconto: number;
  valorFrete: number;
  valorOutrasDespesas: number;
  situacao: number;
  data: string;
  dataEntrega: string | null;
  dataPrevista: string | null;
  dataEnvio: string | null;
  observacoes: string | null;
  observacoesInternas: string | null;
  numeroOrdemCompra: string | null;
  origemPedido: number;
  cliente: TinyCliente | null;
  enderecoEntrega: TinyEnderecoEntrega | null;
  ecommerce: TinyEcommerce | null;
  transportador: TinyTransportador | null;
  deposito: { id: number; nome: string } | null;
  vendedor: { id: number; nome: string } | null;
  naturezaOperacao: { id: number; nome: string } | null;
  intermediador: TinyIntermediador | null;
  listaPreco: { id: number; nome: string; acrescimoDesconto: number } | null;
  pagamento: TinyPagamento | null;
  itens: TinyItem[];
  pagamentosIntegrados: TinyPagamentoIntegrado[];
}

export interface TinyCliente {
  id: number;
  nome: string;
  codigo: string | null;
  fantasia: string | null;
  tipoPessoa: string;
  cpfCnpj: string;
  inscricaoEstadual: string | null;
  rg: string | null;
  telefone: string | null;
  celular: string | null;
  email: string | null;
  endereco: Record<string, unknown> | null;
}

export interface TinyEnderecoEntrega {
  endereco: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  municipio: string;
  cep: string;
  uf: string;
  pais: string;
  nomeDestinatario: string | null;
  cpfCnpj: string | null;
  tipoPessoa: string | null;
  telefone: string | null;
  inscricaoEstadual: string | null;
}

export interface TinyEcommerce {
  id: number;
  nome: string;
  numeroPedidoEcommerce: string | null;
  numeroPedidoCanalVenda: string | null;
  canalVenda: string | null;
}

export interface TinyTransportador {
  id: number;
  nome: string;
  fretePorConta: string | null;
  formaEnvio: string | null;
  formaFrete: string | null;
  codigoRastreamento: string | null;
  urlRastreamento: string | null;
}

export interface TinyIntermediador {
  id: number;
  nome: string;
  cnpj: string | null;
  cnpjPagamentoInstituicao: string | null;
}

export interface TinyPagamento {
  formaRecebimento: string | null;
  meioPagamento: string | null;
  condicaoPagamento: string | null;
  parcelas: unknown[];
}

export interface TinyItem {
  produto: {
    id: number;
    sku: string;
    descricao: string;
    tipo: string;
  };
  quantidade: number;
  valorUnitario: number;
  infoAdicional: string | null;
}

export interface TinyPagamentoIntegrado {
  valor: number;
  tipoPagamento: string | null;
  cnpjIntermediador: string | null;
  codigoAutorizacao: string | null;
  codigoBandeira: string | null;
}
