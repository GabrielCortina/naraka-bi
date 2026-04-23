-- ============================================================
-- 051_sku_custo.sql
--
-- Custo de mercadoria (CMV) por SKU pai e faixa de tamanho.
-- Base para a aba de Lucro e Prejuízo — cada item de pedido resolve
-- seu CMV via (sku_pai, faixa, data_pedido) e o restante do dashboard
-- deriva margem = receita_liquida − custos − CMV.
--
-- Modelo:
--   - sku_pai: prefixo numérico do SKU (ex: "90909" para "90909P-G").
--   - faixa: 'regular' (tamanhos padrão), 'plus' (plus size) ou 'unico'
--     (mesmo custo para todos os tamanhos).
--   - tamanhos: array de tamanhos que a faixa cobre. Vazio/ignorado
--     para faixa='unico'.
--   - vigência: (inicio, fim) — custo pode mudar ao longo do tempo
--     (novo fornecedor, ajuste de preço). fim=NULL = vigente.
--
-- Pedidos com SKU pai sem custo cadastrado retornam CMV = 0 — nunca
-- bloqueiam o cálculo de lucro.
-- ============================================================

CREATE TABLE IF NOT EXISTS sku_custo (
  id                SERIAL PRIMARY KEY,
  sku_pai           TEXT NOT NULL,
  faixa             TEXT NOT NULL DEFAULT 'unico',
  tamanhos          TEXT[] NOT NULL DEFAULT '{}',
  custo_unitario    NUMERIC NOT NULL,
  vigencia_inicio   DATE NOT NULL DEFAULT CURRENT_DATE,
  vigencia_fim      DATE,
  observacao        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (sku_pai, faixa, vigencia_inicio),

  CONSTRAINT chk_faixa CHECK (faixa IN ('regular', 'plus', 'unico')),
  CONSTRAINT chk_custo_positivo CHECK (custo_unitario > 0),
  CONSTRAINT chk_vigencia CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);

CREATE INDEX IF NOT EXISTS idx_sku_custo_pai
  ON sku_custo (sku_pai);

CREATE INDEX IF NOT EXISTS idx_sku_custo_vigencia
  ON sku_custo (vigencia_inicio, vigencia_fim);

GRANT SELECT ON sku_custo TO anon, authenticated;

COMMENT ON TABLE sku_custo IS
  'Custo de mercadoria (CMV) por SKU pai e faixa de tamanho. Usado para calcular lucro/prejuízo por pedido. SKUs sem custo cadastrado são tratados como CMV = 0.';
