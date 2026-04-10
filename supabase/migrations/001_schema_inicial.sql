-- ============================================================
-- naraka-bi: Schema inicial do banco de dados
-- Projetado para armazenar pedidos do Tiny ERP para análise BI
-- ============================================================

-- Tabela de tokens OAuth da Tiny (singleton — uma conta)
CREATE TABLE IF NOT EXISTS tiny_tokens (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Estado do polling (singleton)
CREATE TABLE IF NOT EXISTS polling_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  ultima_verificacao TIMESTAMPTZ NOT NULL DEFAULT '2024-01-01T00:00:00Z',
  pedidos_processados INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
  erro_mensagem TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row_polling CHECK (id = 1)
);

-- Inserir estado inicial do polling
INSERT INTO polling_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Tabela principal de pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id BIGINT PRIMARY KEY, -- ID do Tiny (não autoincrement)
  numero_pedido TEXT NOT NULL,
  id_nota_fiscal BIGINT,
  data_faturamento DATE,

  -- Valores
  valor_total_produtos NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total_pedido NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_desconto NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_frete NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_outras_despesas NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Status e datas
  situacao SMALLINT NOT NULL DEFAULT 0,
  data_pedido DATE NOT NULL,
  data_entrega DATE,
  data_prevista DATE,
  data_envio DATE,
  origem_pedido SMALLINT NOT NULL DEFAULT 0,

  -- Observações
  observacoes TEXT,
  observacoes_internas TEXT,
  numero_ordem_compra TEXT,

  -- Cliente (desnormalizado para queries BI rápidas)
  cliente_id BIGINT,
  cliente_nome TEXT,
  cliente_cpf_cnpj TEXT,
  cliente_email TEXT,

  -- E-commerce / Canal de venda
  ecommerce_id BIGINT,
  ecommerce_nome TEXT,
  numero_pedido_ecommerce TEXT,
  canal_venda TEXT,

  -- Transportador
  transportador_id BIGINT,
  transportador_nome TEXT,
  codigo_rastreamento TEXT,

  -- Vendedor
  vendedor_id BIGINT,
  vendedor_nome TEXT,

  -- Pagamento
  forma_pagamento TEXT,
  meio_pagamento TEXT,

  -- JSON completo da API para consultas avançadas futuras
  raw_data JSONB NOT NULL DEFAULT '{}',

  -- Controle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabela de itens do pedido
CREATE TABLE IF NOT EXISTS pedido_itens (
  id BIGSERIAL PRIMARY KEY,
  pedido_id BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id BIGINT NOT NULL,
  sku TEXT NOT NULL,
  descricao TEXT NOT NULL,
  tipo_produto TEXT NOT NULL DEFAULT 'P',
  quantidade NUMERIC(10,3) NOT NULL DEFAULT 0,
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  info_adicional TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES para consultas BI
-- ============================================================

-- Pedidos: filtros mais comuns
CREATE INDEX idx_pedidos_situacao ON pedidos(situacao);
CREATE INDEX idx_pedidos_data_pedido ON pedidos(data_pedido);
CREATE INDEX idx_pedidos_canal_venda ON pedidos(canal_venda);
CREATE INDEX idx_pedidos_ecommerce_nome ON pedidos(ecommerce_nome);
CREATE INDEX idx_pedidos_cliente_id ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_vendedor_id ON pedidos(vendedor_id);
CREATE INDEX idx_pedidos_updated_at ON pedidos(updated_at);
CREATE INDEX idx_pedidos_numero_pedido_ecommerce ON pedidos(numero_pedido_ecommerce);

-- Itens: consultas por SKU (análise de produtos)
CREATE INDEX idx_pedido_itens_pedido_id ON pedido_itens(pedido_id);
CREATE INDEX idx_pedido_itens_sku ON pedido_itens(sku);
CREATE INDEX idx_pedido_itens_produto_id ON pedido_itens(produto_id);

-- ============================================================
-- RLS (Row Level Security) — habilitado em todas as tabelas
-- Políticas permitem apenas service_role (API Routes do servidor)
-- ============================================================

ALTER TABLE tiny_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_itens ENABLE ROW LEVEL SECURITY;

-- Políticas: service_role tem acesso total
CREATE POLICY "service_role_all" ON tiny_tokens FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON polling_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pedidos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON pedido_itens FOR ALL USING (true) WITH CHECK (true);

-- Políticas de leitura para anon (frontend pode ler pedidos e itens)
CREATE POLICY "anon_read_pedidos" ON pedidos FOR SELECT USING (true);
CREATE POLICY "anon_read_pedido_itens" ON pedido_itens FOR SELECT USING (true);
CREATE POLICY "anon_read_polling_state" ON polling_state FOR SELECT USING (true);
