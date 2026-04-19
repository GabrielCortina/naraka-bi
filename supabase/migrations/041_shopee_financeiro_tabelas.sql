-- ============================================================
-- 041_shopee_financeiro_tabelas.sql
--
-- Módulo Financeiro Shopee (fase 2A) — criação de todas as
-- tabelas que armazenam os dados da Open Platform v2.
--
-- Arquitetura:
--   - Multi-loja: toda tabela tem shop_id (sem FK formal para
--     shopee_tokens — evita cascatas inesperadas).
--   - Chave natural: UNIQUE(shop_id, <id_shopee>) para UPSERT.
--   - Dedupe por (shop_id, chave) + synced_at em todas.
--   - Monetário: NUMERIC(12,2) (nunca float/real).
--   - Tempo: TIMESTAMPTZ.
--   - Sem RLS — acesso só via service_role.
--
-- Referências:
--   - SHOPEE_API_REFERENCE.md §3.1–3.3, 3.7, 3.11
--   - shopee-payment-docs.md §1 (escrow), §3 (wallet + enum), §8 (order_detail)
--   - shopee-docs-oficial.md §3 (sign/base_string)
-- ============================================================


-- ============================================================
-- TABELA 1: shopee_pedidos
-- Status e datas financeiras do pedido na Shopee. NÃO duplica
-- dados do Tiny — guarda só o que é exclusivo da Shopee.
-- Origem: get_order_detail (SHOPEE_API_REFERENCE.md §3.1).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_pedidos (
  id                       BIGSERIAL PRIMARY KEY,
  shop_id                  BIGINT NOT NULL,
  order_sn                 TEXT NOT NULL,

  order_status             TEXT,
  currency                 TEXT DEFAULT 'BRL',
  total_amount             NUMERIC(12,2),
  payment_method           TEXT,
  shipping_carrier         TEXT,
  estimated_shipping_fee   NUMERIC(12,2),
  actual_shipping_fee      NUMERIC(12,2),

  create_time              TIMESTAMPTZ,
  pay_time                 TIMESTAMPTZ,
  ship_time                TIMESTAMPTZ,
  complete_time            TIMESTAMPTZ,
  update_time              TIMESTAMPTZ,

  fulfillment_flag         TEXT,
  cod                      BOOLEAN DEFAULT false,

  synced_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (shop_id, order_sn)
);

CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_shop_order
  ON shopee_pedidos (shop_id, order_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_status
  ON shopee_pedidos (shop_id, order_status);

CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_complete_time
  ON shopee_pedidos (shop_id, complete_time)
  WHERE complete_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shopee_pedidos_update_time
  ON shopee_pedidos (shop_id, update_time);

COMMENT ON TABLE shopee_pedidos IS
  'Pedidos sincronizados da Shopee Open Platform v2. Fonte: get_order_detail. Guarda status e datas Shopee; valores monetários detalhados ficam em shopee_escrow.';


-- ============================================================
-- TABELA 2: shopee_escrow
-- Breakdown financeiro completo por pedido — coração do módulo
-- financeiro. Origem: get_escrow_detail + get_escrow_list.
-- Campos BR-locais: net_commission_fee, net_service_fee, pix_discount.
-- Ref: shopee-payment-docs.md §1 (order_income, 120+ campos).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_escrow (
  id                               BIGSERIAL PRIMARY KEY,
  shop_id                          BIGINT NOT NULL,
  order_sn                         TEXT NOT NULL,

  -- Totais
  buyer_total_amount               NUMERIC(12,2),
  escrow_amount                    NUMERIC(12,2),
  escrow_amount_after_adjustment   NUMERIC(12,2),
  original_price                   NUMERIC(12,2),
  order_selling_price              NUMERIC(12,2),
  order_discounted_price           NUMERIC(12,2),

  -- Descontos e vouchers
  seller_discount                  NUMERIC(12,2),
  shopee_discount                  NUMERIC(12,2),
  voucher_from_seller              NUMERIC(12,2),
  voucher_from_shopee              NUMERIC(12,2),
  coins                            NUMERIC(12,2),

  -- Taxas Shopee
  commission_fee                   NUMERIC(12,2),
  net_commission_fee               NUMERIC(12,2),
  service_fee                      NUMERIC(12,2),
  net_service_fee                  NUMERIC(12,2),
  seller_transaction_fee           NUMERIC(12,2),
  credit_card_transaction_fee      NUMERIC(12,2),
  credit_card_promotion            NUMERIC(12,2),
  payment_promotion                NUMERIC(12,2),

  -- Impostos
  cross_border_tax                 NUMERIC(12,2),
  escrow_tax                       NUMERIC(12,2),
  withholding_tax                  NUMERIC(12,2),

  -- Frete
  final_shipping_fee               NUMERIC(12,2),
  actual_shipping_fee              NUMERIC(12,2),
  estimated_shipping_fee           NUMERIC(12,2),
  shopee_shipping_rebate           NUMERIC(12,2),
  seller_shipping_discount         NUMERIC(12,2),
  shipping_fee_discount_from_3pl   NUMERIC(12,2),
  reverse_shipping_fee             NUMERIC(12,2),

  -- Retornos e ajustes
  seller_return_refund             NUMERIC(12,2),
  seller_lost_compensation         NUMERIC(12,2),
  seller_coin_cash_back            NUMERIC(12,2),
  campaign_fee                     NUMERIC(12,2),
  order_ams_commission_fee         NUMERIC(12,2),
  fbs_fee                          NUMERIC(12,2),
  pix_discount                     NUMERIC(12,2),
  total_adjustment_amount          NUMERIC(12,2),
  cost_of_goods_sold               NUMERIC(12,2),

  buyer_payment_method             TEXT,

  -- Release (get_escrow_list)
  escrow_release_time              TIMESTAMPTZ,
  payout_amount                    NUMERIC(12,2),
  is_released                      BOOLEAN DEFAULT false,

  synced_at                        TIMESTAMPTZ DEFAULT NOW(),
  raw_json                         JSONB,

  UNIQUE (shop_id, order_sn)
);

CREATE INDEX IF NOT EXISTS idx_shopee_escrow_shop_order
  ON shopee_escrow (shop_id, order_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_escrow_released
  ON shopee_escrow (shop_id, is_released);

CREATE INDEX IF NOT EXISTS idx_shopee_escrow_release_time
  ON shopee_escrow (shop_id, escrow_release_time)
  WHERE escrow_release_time IS NOT NULL;

COMMENT ON TABLE shopee_escrow IS
  'Detalhamento financeiro por pedido (get_escrow_detail). Tabela mais importante do módulo: contém valores brutos, taxas, descontos, frete e release. raw_json preserva payload completo para auditoria.';


-- ============================================================
-- TABELA 3: shopee_wallet
-- Extrato da carteira Shopee. Cobre receita de pedidos,
-- saques, gasto Ads, afiliados, ajustes.
-- Enum transaction_type: ver SHOPEE_API_REFERENCE.md §3.2
-- (códigos 101..460 documentados).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_wallet (
  id                      BIGSERIAL PRIMARY KEY,
  shop_id                 BIGINT NOT NULL,
  transaction_id          BIGINT NOT NULL,

  transaction_type        TEXT NOT NULL,
  transaction_type_code   INT,
  status                  TEXT,
  amount                  NUMERIC(12,2) NOT NULL,
  current_balance         NUMERIC(12,2),

  order_sn                TEXT,
  refund_sn               TEXT,
  description             TEXT,
  buyer_name              TEXT,
  money_flow              TEXT,
  wallet_type             TEXT,
  transaction_tab_type    TEXT,
  withdrawal_id           BIGINT,
  reason                  TEXT,

  create_time             TIMESTAMPTZ NOT NULL,
  synced_at               TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (shop_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_shopee_wallet_shop_txn
  ON shopee_wallet (shop_id, transaction_id);

CREATE INDEX IF NOT EXISTS idx_shopee_wallet_type
  ON shopee_wallet (shop_id, transaction_type);

CREATE INDEX IF NOT EXISTS idx_shopee_wallet_order
  ON shopee_wallet (shop_id, order_sn)
  WHERE order_sn IS NOT NULL AND order_sn != '';

CREATE INDEX IF NOT EXISTS idx_shopee_wallet_create_time
  ON shopee_wallet (shop_id, create_time);

CREATE INDEX IF NOT EXISTS idx_shopee_wallet_money_flow
  ON shopee_wallet (shop_id, money_flow);

COMMENT ON TABLE shopee_wallet IS
  'Extrato da carteira Shopee (get_wallet_transaction_list). Uma linha por transação: entrada de pedido (101), saques (201/202/203), Ads (450), afiliados (455/460) e ajustes. Amount positivo = entrada, negativo = saída.';


-- ============================================================
-- TABELA 4: shopee_returns
-- Devoluções e reembolsos (get_return_list / get_return_detail).
-- Ref: SHOPEE_API_REFERENCE.md §3.3.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_returns (
  id                        BIGSERIAL PRIMARY KEY,
  shop_id                   BIGINT NOT NULL,
  return_sn                 TEXT NOT NULL,
  order_sn                  TEXT NOT NULL,

  status                    TEXT,
  reason                    TEXT,
  text_reason               TEXT,
  refund_amount             NUMERIC(12,2),
  currency                  TEXT DEFAULT 'BRL',
  amount_before_discount    NUMERIC(12,2),
  needs_logistics           BOOLEAN,
  tracking_number           TEXT,

  create_time               TIMESTAMPTZ,
  update_time               TIMESTAMPTZ,
  due_date                  TIMESTAMPTZ,
  return_ship_due_date      TIMESTAMPTZ,
  return_seller_due_date    TIMESTAMPTZ,

  negotiation_status        TEXT,
  return_refund_type        TEXT,

  synced_at                 TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (shop_id, return_sn)
);

CREATE INDEX IF NOT EXISTS idx_shopee_returns_shop_return
  ON shopee_returns (shop_id, return_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_returns_order
  ON shopee_returns (shop_id, order_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_returns_status
  ON shopee_returns (shop_id, status);

CREATE INDEX IF NOT EXISTS idx_shopee_returns_create_time
  ON shopee_returns (shop_id, create_time);

COMMENT ON TABLE shopee_returns IS
  'Devoluções e reembolsos (get_return_list). Vinculadas a order_sn. Usadas na conciliação para estados DEVOLVIDO / REEMBOLSADO_PARCIAL / EM_DISPUTA.';


-- ============================================================
-- TABELA 5: shopee_ads_daily
-- Gasto de Ads agregado por dia (get_all_cpc_ads_daily_performance).
-- Ads são por PERÍODO — não vinculáveis a order_sn individual.
-- Ref: SHOPEE_API_REFERENCE.md §3.7.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_ads_daily (
  id                    BIGSERIAL PRIMARY KEY,
  shop_id               BIGINT NOT NULL,
  date                  DATE NOT NULL,

  impression            BIGINT DEFAULT 0,
  clicks                BIGINT DEFAULT 0,
  ctr                   NUMERIC(8,4) DEFAULT 0,

  direct_order          INT DEFAULT 0,
  broad_order           INT DEFAULT 0,
  direct_conversions    NUMERIC(8,4) DEFAULT 0,
  broad_conversions     NUMERIC(8,4) DEFAULT 0,
  direct_item_sold      INT DEFAULT 0,
  broad_item_sold       INT DEFAULT 0,
  direct_gmv            NUMERIC(12,2) DEFAULT 0,
  broad_gmv             NUMERIC(12,2) DEFAULT 0,

  expense               NUMERIC(12,2) DEFAULT 0,
  cost_per_conversion   NUMERIC(12,2) DEFAULT 0,
  direct_roas           NUMERIC(8,2) DEFAULT 0,
  broad_roas            NUMERIC(8,2) DEFAULT 0,

  synced_at             TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (shop_id, date)
);

CREATE INDEX IF NOT EXISTS idx_shopee_ads_shop_date
  ON shopee_ads_daily (shop_id, date);

COMMENT ON TABLE shopee_ads_daily IS
  'Gasto de Shopee Ads agregado por dia e loja (get_all_cpc_ads_daily_performance). expense é o gasto total do dia — base para custo de aquisição por período.';


-- ============================================================
-- TABELA 6: shopee_conciliacao
-- Cruzamento Tiny × Shopee por pedido. Uma linha por order_sn
-- com classificação automática derivada dos dados das outras
-- 5 tabelas. Ref: SHOPEE_API_REFERENCE.md §7 (14 classificações).
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_conciliacao (
  id                         BIGSERIAL PRIMARY KEY,
  shop_id                    BIGINT NOT NULL,
  order_sn                   TEXT NOT NULL,

  tiny_pedido_id             BIGINT,
  tiny_numero_pedido         TEXT,

  -- Status operacional (Tiny)
  status_tiny                TEXT,
  data_entrega_tiny          TIMESTAMPTZ,

  -- Status financeiro (Shopee)
  status_shopee              TEXT,
  data_completed_shopee      TIMESTAMPTZ,

  -- Dados financeiros (escrow)
  valor_bruto_shopee         NUMERIC(12,2),
  valor_liquido_shopee       NUMERIC(12,2),
  valor_comissao             NUMERIC(12,2),
  valor_taxa_servico         NUMERIC(12,2),
  valor_frete_liquido        NUMERIC(12,2),
  valor_reembolso            NUMERIC(12,2),

  -- Conciliação
  valor_bruto_tiny           NUMERIC(12,2),
  divergencia_valor          NUMERIC(12,2),
  divergencia_percentual     NUMERIC(6,2),

  -- Pagamento
  data_escrow_release        TIMESTAMPTZ,
  valor_pago                 NUMERIC(12,2),
  dias_para_pagamento        INT,

  -- Classificação automática (14 estados — ver §7)
  classificacao              TEXT NOT NULL DEFAULT 'DADOS_INSUFICIENTES',
  classificacao_severidade   TEXT DEFAULT 'info',

  observacoes                TEXT,
  atualizado_em              TIMESTAMPTZ DEFAULT NOW(),
  processado_em              TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (shop_id, order_sn)
);

CREATE INDEX IF NOT EXISTS idx_shopee_conc_shop_order
  ON shopee_conciliacao (shop_id, order_sn);

CREATE INDEX IF NOT EXISTS idx_shopee_conc_classificacao
  ON shopee_conciliacao (shop_id, classificacao);

CREATE INDEX IF NOT EXISTS idx_shopee_conc_severidade
  ON shopee_conciliacao (shop_id, classificacao_severidade)
  WHERE classificacao_severidade != 'info';

CREATE INDEX IF NOT EXISTS idx_shopee_conc_tiny
  ON shopee_conciliacao (tiny_pedido_id)
  WHERE tiny_pedido_id IS NOT NULL;

-- Trigger: mantém atualizado_em em sync automaticamente
CREATE OR REPLACE FUNCTION update_shopee_conciliacao_atualizado_em()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopee_conciliacao_atualizado_em ON shopee_conciliacao;
CREATE TRIGGER trg_shopee_conciliacao_atualizado_em
BEFORE UPDATE ON shopee_conciliacao
FOR EACH ROW
EXECUTE FUNCTION update_shopee_conciliacao_atualizado_em();

COMMENT ON TABLE shopee_conciliacao IS
  'Cruzamento Tiny × Shopee por pedido (chave: shop_id + order_sn). Classificação automática em 14 estados (AGUARDANDO_ENVIO → PAGO_OK → ...). processado_em marca a última rodada do job de conciliação.';


-- ============================================================
-- TABELA 7: shopee_conciliacao_log
-- Histórico append-only de mudanças de classificação. Cada
-- transição vira uma linha — permite auditoria retroativa e
-- análise de como um pedido caminhou entre estados.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_conciliacao_log (
  id                        BIGSERIAL PRIMARY KEY,
  shop_id                   BIGINT NOT NULL,
  order_sn                  TEXT NOT NULL,

  classificacao_anterior    TEXT,
  classificacao_nova        TEXT NOT NULL,
  motivo                    TEXT,
  dados_snapshot            JSONB,

  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopee_conc_log_order
  ON shopee_conciliacao_log (shop_id, order_sn, created_at);

COMMENT ON TABLE shopee_conciliacao_log IS
  'Histórico append-only de mudanças de classificação em shopee_conciliacao. Cada transição gera uma linha com snapshot dos dados usados na decisão. Nunca fazer UPDATE/DELETE — só INSERT.';
