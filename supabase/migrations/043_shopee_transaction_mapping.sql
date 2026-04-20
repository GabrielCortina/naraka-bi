-- ============================================================
-- 043_shopee_transaction_mapping.sql
--
-- Tabela de mapeamento de tipos de transação da wallet Shopee
-- para classificação financeira. A API /api/shopee/financeiro lê
-- esta tabela no runtime — quando a Shopee criar um tipo novo,
-- basta inserir uma linha aqui (sem mexer no código).
--
-- Colunas:
--   transaction_type      PK textual (ex: 'ESCROW_VERIFIED_ADD')
--   classificacao         receita | custo_plataforma |
--                         custo_aquisicao | custo_friccao |
--                         informativo | ignorar
--   kpi_destino           receita_escrow | comissao | taxa | ads |
--                         afiliados | difal | devolucao |
--                         devolucao_frete | saque | pedidos_negativos |
--                         fbs | outros | ignorar
--   descricao_pt          descrição amigável em português (UI)
--   entra_no_custo_total  soma no "Custo total Shopee"?
--   duplica_com           tabela-fonte alternativa (ex: 'shopee_ads_daily'
--                         para SPM_DEDUCT) — indica que a transação
--                         duplica com outra origem de dados
--   natureza              credito | debito | neutro
--
-- Ref: shopee-payment-docs.md §3 (enum wallet transaction_type).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_transaction_mapping (
  transaction_type       TEXT PRIMARY KEY,
  classificacao          TEXT NOT NULL,
  kpi_destino            TEXT NOT NULL,
  descricao_pt           TEXT NOT NULL,
  entra_no_custo_total   BOOLEAN NOT NULL DEFAULT false,
  duplica_com            TEXT,
  natureza               TEXT NOT NULL DEFAULT 'debito',
  updated_at             TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT chk_classificacao CHECK (classificacao IN (
    'receita', 'custo_plataforma', 'custo_aquisicao',
    'custo_friccao', 'informativo', 'ignorar'
  )),
  CONSTRAINT chk_kpi_destino CHECK (kpi_destino IN (
    'receita_escrow', 'comissao', 'taxa', 'ads', 'afiliados',
    'difal', 'devolucao', 'devolucao_frete', 'saque',
    'pedidos_negativos', 'fbs', 'outros', 'ignorar'
  )),
  CONSTRAINT chk_natureza CHECK (natureza IN ('credito', 'debito', 'neutro'))
);

COMMENT ON TABLE shopee_transaction_mapping IS
  'Mapeamento de tipos de transação da wallet Shopee para classificação financeira. Atualizar quando novos tipos aparecerem — a API /api/shopee/financeiro passa a honrar automaticamente.';


-- ============================================================
-- SEEDS — tipos conhecidos. UPSERT para ser idempotente.
-- ============================================================

INSERT INTO shopee_transaction_mapping
  (transaction_type, classificacao, kpi_destino, descricao_pt, entra_no_custo_total, duplica_com, natureza)
VALUES
  -- RECEITA (não entra em custo — é o que entra no bolso)
  ('ESCROW_VERIFIED_ADD', 'receita', 'receita_escrow',
    'Renda do pedido (escrow verificado)', false, 'shopee_escrow', 'credito'),

  -- ADS — IGNORAR na wallet (fonte única: shopee_ads_daily)
  ('SPM_DEDUCT', 'ignorar', 'ignorar',
    'Recarga por compra de Ads (duplica com shopee_ads_daily)', false, 'shopee_ads_daily', 'debito'),
  ('PAID_ADS', 'ignorar', 'ignorar',
    'Gasto de Ads debitado (duplica com shopee_ads_daily)', false, 'shopee_ads_daily', 'debito'),
  ('PAID_ADS_REFUND', 'ignorar', 'ignorar',
    'Reembolso de Ads (duplica com shopee_ads_daily)', false, 'shopee_ads_daily', 'credito'),

  -- PEDIDOS NEGATIVOS (escrow < 0 — pedido que deu prejuízo)
  ('ESCROW_VERIFIED_MINUS', 'custo_friccao', 'pedidos_negativos',
    'Escrow negativo (comissão + taxas > valor do pedido)', true, NULL, 'debito'),

  -- AFILIADOS (marketing)
  ('AFFILIATE_ADS_SELLER_FEE', 'custo_aquisicao', 'afiliados',
    'Taxa de Ads de afiliado', true, NULL, 'debito'),
  ('AFFILIATE_FEE_DEDUCT', 'custo_aquisicao', 'afiliados',
    'Taxa de afiliado (marketing)', true, NULL, 'debito'),
  ('AFFILIATE_ADS_SELLER_FEE_REFUND', 'custo_aquisicao', 'afiliados',
    'Reembolso de taxa de afiliado', false, NULL, 'credito'),

  -- DEVOLUÇÕES
  ('ADJUSTMENT_FOR_RR_AFTER_ESCROW_VERIFIED', 'custo_friccao', 'devolucao',
    'Débito por devolução após escrow liberado', true, NULL, 'debito'),

  -- DIFAL / ICMS
  ('ADJUSTMENT_CENTER_DEDUCT', 'custo_friccao', 'difal',
    'Diferencial de alíquota ICMS (DIFAL)', true, NULL, 'debito'),
  ('ADJUSTMENT_CENTER_ADD', 'informativo', 'ignorar',
    'Crédito do Adjustment Center', false, NULL, 'credito'),

  -- SAQUES (informativo, não é custo)
  ('WITHDRAWAL_CREATED', 'informativo', 'saque',
    'Saque criado (transferência para conta PJ)', false, NULL, 'debito'),
  ('WITHDRAWAL_COMPLETED', 'informativo', 'saque',
    'Saque concluído', false, NULL, 'neutro'),
  ('WITHDRAWAL_CANCELLED', 'informativo', 'ignorar',
    'Saque cancelado (dinheiro voltou)', false, NULL, 'credito'),

  -- FBS
  ('FBS_ADJUSTMENT_ADD', 'informativo', 'fbs',
    'Crédito FBS (compensação)', false, NULL, 'credito'),
  ('FBS_ADJUSTMENT_MINUS', 'custo_friccao', 'fbs',
    'Custo FBS (armazenamento/manuseio)', true, NULL, 'debito'),

  -- AJUSTES GENÉRICOS
  ('ADJUSTMENT_ADD', 'informativo', 'outros',
    'Ajuste positivo (compensação)', false, NULL, 'credito'),
  ('ADJUSTMENT_MINUS', 'custo_friccao', 'outros',
    'Ajuste negativo', true, NULL, 'debito'),

  -- FSF
  ('FSF_COST_PASSING_DEDUCT', 'custo_friccao', 'outros',
    'FSF custo para pedidos cancelados/inválidos', true, NULL, 'debito'),

  -- FAST ESCROW (informativo — adiantamentos + devolução do adiantamento)
  ('FAST_ESCROW_DISBURSE', 'informativo', 'ignorar',
    'Fast escrow (adiantamento)', false, NULL, 'credito'),
  ('FAST_ESCROW_DEDUCT', 'informativo', 'ignorar',
    'Fast escrow deduzido (devolução)', false, NULL, 'debito'),
  ('FAST_ESCROW_DISBURSE_REMAIN', 'informativo', 'ignorar',
    'Fast escrow (segundo desembolso)', false, NULL, 'credito')
ON CONFLICT (transaction_type) DO UPDATE SET
  classificacao = EXCLUDED.classificacao,
  kpi_destino = EXCLUDED.kpi_destino,
  descricao_pt = EXCLUDED.descricao_pt,
  entra_no_custo_total = EXCLUDED.entra_no_custo_total,
  duplica_com = EXCLUDED.duplica_com,
  natureza = EXCLUDED.natureza,
  updated_at = NOW();
