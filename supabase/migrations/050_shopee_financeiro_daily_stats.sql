-- ============================================================
-- 050_shopee_financeiro_daily_stats.sql
--
-- Módulo Financeiro Shopee — tabela summary pré-calculada por
-- (dia, shop_id) com todos os KPIs do dashboard financeiro.
-- Mesmo padrão do dashboard_daily_stats (migration 024).
--
-- ETAPA 1: CREATE TABLE + CREATE FUNCTION de refresh.
-- Esta migration NÃO cria cron, NÃO altera a API, NÃO faz backfill.
--
-- Paridade 100% com src/app/api/shopee/financeiro/route.ts:
--   - GMV: SUM(buyer_total_amount) com 0 quando null (API linha 335-345)
--   - receita_liquida: SUM(COALESCE(escrow_amount, payout_amount, 0))
--     com NEGATIVOS incluídos (API linha 340, 346)
--   - total_pedidos: COUNT de TODAS as linhas liberadas, inclusive
--     stubs sem detail (API linha 328)
--   - hasDetail = (buyer_total_amount != 0 OR escrow_amount IS NOT NULL)
--     aplicado como FILTER clause — NÃO como WHERE global (API linha 350)
--   - Wallet: débito e crédito armazenados SEPARADOS por KPI — API
--     calcula líquido = max(0, débito − crédito) ao consumir a summary
--   - pedidos_negativos armazenado em 2 fontes: wallet (principal, API)
--     e escrow (secundário via escrow_amount < 0)
--   - Compensações detectam 3 padrões: kpi='compensacao', tt='' com
--     description match, e ADJUSTMENT_ADD com description match
--   - Saques: sem filtro de natureza — só amount < 0 (API linha 540-545)
--   - duplica_com: pula só quando != '' AND != 'shopee_escrow'
--
-- Conversão BRT:
--   dia em BRT = [YYYY-MM-DD 03:00:00+00, YYYY-MM-DD+1 03:00:00+00)
-- ============================================================


-- ============================================================
-- 1. TABELA SUMMARY (1 linha por dia × loja)
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_financeiro_daily_stats (
  data DATE NOT NULL,
  shop_id BIGINT NOT NULL,

  -- ============ RECEITA (fonte: shopee_escrow, dia BRT pelo escrow_release_time) ============
  gmv NUMERIC DEFAULT 0,                            -- SUM(buyer_total_amount WHEN != 0) + 0 nas outras
  receita_liquida NUMERIC DEFAULT 0,                -- SUM(COALESCE(escrow_amount, payout_amount, 0)) — inclui negativos
  total_pedidos INT DEFAULT 0,                      -- COUNT(*) de todos os escrows liberados no dia
  count_with_detail INT DEFAULT 0,                  -- COUNT WHERE hasDetail
  escrows_com_detail INT DEFAULT 0,                 -- = count_with_detail (expo direta p/ API)
  escrows_sem_detail INT DEFAULT 0,                 -- total_pedidos − count_with_detail
  order_selling_price_total NUMERIC DEFAULT 0,      -- SUM(order_selling_price) WHERE hasDetail
  order_discounted_price_total NUMERIC DEFAULT 0,   -- SUM(order_discounted_price) WHERE hasDetail — p/ preco_medio_efetivo

  -- ============ CUSTOS PLATAFORMA (fonte: shopee_escrow, hasDetail) ============
  comissao NUMERIC DEFAULT 0,                       -- SUM(commission_fee)
  taxa_servico NUMERIC DEFAULT 0,                   -- SUM(service_fee)
  seller_transaction_fee NUMERIC DEFAULT 0,         -- SUM(seller_transaction_fee) — taxa de transação

  -- ============ CUSTOS AQUISIÇÃO ============
  ads_expense NUMERIC DEFAULT 0,                    -- SUM(expense) shopee_ads_daily
  ads_broad_gmv NUMERIC DEFAULT 0,                  -- SUM(broad_gmv) shopee_ads_daily (p/ TACOS)
  afiliados_escrow NUMERIC DEFAULT 0,               -- SUM(order_ams_commission_fee) escrow hasDetail
  afiliados_wallet_debito NUMERIC DEFAULT 0,        -- SUM ABS(amount) kpi='afiliados', lado débito
  afiliados_wallet_credito NUMERIC DEFAULT 0,       -- SUM ABS(amount) kpi='afiliados', lado crédito
  cupons_seller NUMERIC DEFAULT 0,                  -- SUM(voucher_from_seller) escrow hasDetail

  -- ============ CUSTOS FRICÇÃO — ESCROW ============
  devolucoes_frete_reverso NUMERIC DEFAULT 0,       -- SUM(reverse_shipping_fee) hasDetail AND > 0
  devolucoes_frete_ida NUMERIC DEFAULT 0,           -- SUM(actual_shipping_fee) hasDetail AND reverse>0 AND rebate=0 AND asf>0
  devolucoes_qtd INT DEFAULT 0,                     -- COUNT hasDetail AND reverse_shipping_fee > 0
  devolucoes_reversao NUMERIC DEFAULT 0,            -- SUM ABS(seller_return_refund) hasDetail AND seller_return_refund < 0
  fbs_escrow NUMERIC DEFAULT 0,                     -- SUM(fbs_fee) escrow hasDetail
  pedidos_negativos_escrow NUMERIC DEFAULT 0,       -- SUM ABS(eff_amount) WHERE eff_amount < 0 (eff = COALESCE(escrow,payout,0))
  pedidos_negativos_escrow_qtd INT DEFAULT 0,

  -- ============ CUSTOS FRICÇÃO — WALLET (classificado via shopee_transaction_mapping) ============
  difal NUMERIC DEFAULT 0,                          -- SUM ABS(amount) kpi='difal'
  difal_qtd INT DEFAULT 0,
  fbs_wallet_debito NUMERIC DEFAULT 0,              -- SUM ABS(amount) kpi='fbs', lado débito
  fbs_wallet_credito NUMERIC DEFAULT 0,             -- SUM ABS(amount) kpi='fbs', lado crédito
  pedidos_negativos_wallet NUMERIC DEFAULT 0,       -- SUM ABS(amount) kpi='pedidos_negativos' — FONTE PRINCIPAL
  pedidos_negativos_wallet_qtd INT DEFAULT 0,
  devolucao_total_wallet NUMERIC DEFAULT 0,         -- SUM ABS(amount) kpi='devolucao' — p/ reversao_receita
  devolucao_qtd_wallet INT DEFAULT 0,               -- COUNT kpi='devolucao' — usado em MAX(wallet, escrow)
  outros_debito NUMERIC DEFAULT 0,                  -- SUM ABS débitos — kpi='outros' OR não-mapeado (sem filtro entra_no_custo)
  outros_credito NUMERIC DEFAULT 0,                 -- SUM ABS créditos — mesma condição

  -- ============ SUBSÍDIO SHOPEE (fonte: shopee_escrow, hasDetail) ============
  subsidio_coins NUMERIC DEFAULT 0,                 -- SUM(coins)
  subsidio_voucher_shopee NUMERIC DEFAULT 0,        -- SUM(voucher_from_shopee)
  subsidio_shopee_discount NUMERIC DEFAULT 0,       -- SUM(shopee_discount)
  subsidio_promo_cartao NUMERIC DEFAULT 0,          -- SUM(credit_card_promotion)
  subsidio_pix_discount NUMERIC DEFAULT 0,          -- SUM(pix_discount)

  -- ============ COMPENSAÇÕES (fonte: shopee_wallet, só entradas positivas) ============
  -- Detecção: kpi='compensacao' OR (tt='' AND desc~'objeto perdido|reembolso')
  --          OR (tt='ADJUSTMENT_ADD' AND desc~'compensation|perdido|danificado|extraviado')
  compensacoes_total NUMERIC DEFAULT 0,
  compensacoes_qtd INT DEFAULT 0,

  -- ============ SAQUES (fonte: shopee_wallet, kpi='saque' AND amount < 0) ============
  saques NUMERIC DEFAULT 0,                         -- SUM ABS(amount) — sem filtro de natureza
  saques_qtd INT DEFAULT 0,

  -- ============ MÉDIA DIAS PAGAMENTO (JOIN escrow × pedidos) ============
  dias_pagamento_soma NUMERIC DEFAULT 0,            -- SUM((escrow_release_time − pay_time) em dias)
  dias_pagamento_count INT DEFAULT 0,               -- COUNT onde diff >= 0 e pay_time NOT NULL

  -- ============ SELLER DISCOUNT (informativo, escrow hasDetail) ============
  seller_discount_total NUMERIC DEFAULT 0,

  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (data, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_shopee_fin_daily_shop
  ON shopee_financeiro_daily_stats (shop_id, data);

COMMENT ON TABLE shopee_financeiro_daily_stats IS
  'Summary diário pré-calculado do dashboard financeiro Shopee. 1 linha por (data, shop_id). Populado por refresh_shopee_financeiro_daily(). Paridade 100% com src/app/api/shopee/financeiro/route.ts. Fontes: shopee_escrow, shopee_wallet (via shopee_transaction_mapping), shopee_ads_daily, shopee_pedidos. Débitos e créditos da wallet ficam em colunas separadas — a API calcula o líquido = max(0, debito − credito) ao consumir.';

GRANT SELECT ON shopee_financeiro_daily_stats TO anon, authenticated;


-- ============================================================
-- 2. FUNÇÃO DE REFRESH — recompute uma única (data, shop_id)
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_shopee_financeiro_daily(
  p_data DATE,
  p_shop_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Limites BRT do dia
  v_start TIMESTAMPTZ := (p_data::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;
  v_end   TIMESTAMPTZ := ((p_data + 1)::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;

  -- Escrow
  v_gmv NUMERIC := 0;
  v_receita_liquida NUMERIC := 0;
  v_total_pedidos INT := 0;
  v_count_detail INT := 0;
  v_osp_total NUMERIC := 0;
  v_odp_total NUMERIC := 0;
  v_comissao NUMERIC := 0;
  v_taxa_servico NUMERIC := 0;
  v_seller_tx_fee NUMERIC := 0;
  v_afiliados_escrow NUMERIC := 0;
  v_cupons_seller NUMERIC := 0;
  v_dev_frete_reverso NUMERIC := 0;
  v_dev_frete_ida NUMERIC := 0;
  v_dev_qtd INT := 0;
  v_dev_reversao NUMERIC := 0;
  v_fbs_escrow NUMERIC := 0;
  v_ped_neg_escrow NUMERIC := 0;
  v_ped_neg_escrow_qtd INT := 0;
  v_sub_coins NUMERIC := 0;
  v_sub_voucher_shopee NUMERIC := 0;
  v_sub_shopee_discount NUMERIC := 0;
  v_sub_promo_cartao NUMERIC := 0;
  v_sub_pix_discount NUMERIC := 0;
  v_seller_discount NUMERIC := 0;

  -- Wallet
  v_afil_deb NUMERIC := 0;
  v_afil_cre NUMERIC := 0;
  v_difal NUMERIC := 0;
  v_difal_qtd INT := 0;
  v_fbs_deb NUMERIC := 0;
  v_fbs_cre NUMERIC := 0;
  v_ped_neg_wallet NUMERIC := 0;
  v_ped_neg_wallet_qtd INT := 0;
  v_dev_wallet_total NUMERIC := 0;
  v_dev_wallet_qtd INT := 0;
  v_outros_deb NUMERIC := 0;
  v_outros_cre NUMERIC := 0;
  v_compensacoes NUMERIC := 0;
  v_compensacoes_qtd INT := 0;
  v_saques NUMERIC := 0;
  v_saques_qtd INT := 0;

  -- Ads
  v_ads_expense NUMERIC := 0;
  v_ads_broad_gmv NUMERIC := 0;

  -- Média dias pagamento
  v_dias_soma NUMERIC := 0;
  v_dias_count INT := 0;

  -- Auxiliares do wallet loop
  r RECORD;
  v_desc_lower TEXT;
  v_is_mapped BOOLEAN;
  v_is_credito BOOLEAN;
  v_is_compensacao BOOLEAN;
BEGIN

  -- ============ ESCROW ============
  -- Uma CTE consolida os flags auxiliares (has_buyer, has_detail, eff_amount)
  -- e o SELECT faz todos os agregados com FILTER — espelha a lógica dos
  -- ramos `if (hasDetail)` e `if (a < 0)` do fetchPeriod (route.ts 327-404).
  --
  -- has_detail = (buyer_total_amount != 0) OR (escrow_amount IS NOT NULL)
  -- eff_amount = COALESCE(escrow_amount, payout_amount, 0)
  --   (replica `a = r.escrow_amount != null ? num(r.escrow_amount) : payout`)
  WITH e AS (
    SELECT
      buyer_total_amount,
      (buyer_total_amount IS NOT NULL AND buyer_total_amount != 0) AS has_buyer,
      (
        (buyer_total_amount IS NOT NULL AND buyer_total_amount != 0)
        OR escrow_amount IS NOT NULL
      ) AS has_detail,
      COALESCE(escrow_amount, payout_amount, 0) AS eff_amount,
      order_selling_price,
      order_discounted_price,
      commission_fee,
      service_fee,
      seller_transaction_fee,
      order_ams_commission_fee,
      voucher_from_seller,
      reverse_shipping_fee,
      actual_shipping_fee,
      shopee_shipping_rebate,
      seller_return_refund,
      fbs_fee,
      coins,
      voucher_from_shopee,
      shopee_discount,
      credit_card_promotion,
      pix_discount,
      seller_discount
    FROM shopee_escrow
    WHERE shop_id = p_shop_id
      AND is_released = true
      AND escrow_release_time >= v_start
      AND escrow_release_time < v_end
  )
  SELECT
    COALESCE(SUM(CASE WHEN has_buyer THEN buyer_total_amount ELSE 0 END), 0),
    COALESCE(SUM(eff_amount), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE has_detail),
    COALESCE(SUM(order_selling_price)          FILTER (WHERE has_detail), 0),
    COALESCE(SUM(order_discounted_price)       FILTER (WHERE has_detail), 0),
    COALESCE(SUM(commission_fee)               FILTER (WHERE has_detail), 0),
    COALESCE(SUM(service_fee)                  FILTER (WHERE has_detail), 0),
    COALESCE(SUM(seller_transaction_fee)       FILTER (WHERE has_detail), 0),
    COALESCE(SUM(order_ams_commission_fee)     FILTER (WHERE has_detail), 0),
    COALESCE(SUM(voucher_from_seller)          FILTER (WHERE has_detail), 0),
    COALESCE(SUM(reverse_shipping_fee)         FILTER (WHERE has_detail AND reverse_shipping_fee > 0), 0),
    COALESCE(SUM(actual_shipping_fee)          FILTER (WHERE has_detail
                                                         AND reverse_shipping_fee > 0
                                                         AND shopee_shipping_rebate = 0
                                                         AND actual_shipping_fee > 0), 0),
    COUNT(*)                                   FILTER (WHERE has_detail AND reverse_shipping_fee > 0),
    COALESCE(SUM(ABS(seller_return_refund))    FILTER (WHERE has_detail AND seller_return_refund < 0), 0),
    COALESCE(SUM(fbs_fee)                      FILTER (WHERE has_detail), 0),
    COALESCE(SUM(ABS(eff_amount))              FILTER (WHERE eff_amount < 0), 0),
    COUNT(*)                                   FILTER (WHERE eff_amount < 0),
    COALESCE(SUM(coins)                        FILTER (WHERE has_detail), 0),
    COALESCE(SUM(voucher_from_shopee)          FILTER (WHERE has_detail), 0),
    COALESCE(SUM(shopee_discount)              FILTER (WHERE has_detail), 0),
    COALESCE(SUM(credit_card_promotion)        FILTER (WHERE has_detail), 0),
    COALESCE(SUM(pix_discount)                 FILTER (WHERE has_detail), 0),
    COALESCE(SUM(seller_discount)              FILTER (WHERE has_detail), 0)
  INTO
    v_gmv, v_receita_liquida, v_total_pedidos, v_count_detail,
    v_osp_total, v_odp_total,
    v_comissao, v_taxa_servico, v_seller_tx_fee,
    v_afiliados_escrow, v_cupons_seller,
    v_dev_frete_reverso, v_dev_frete_ida, v_dev_qtd, v_dev_reversao,
    v_fbs_escrow,
    v_ped_neg_escrow, v_ped_neg_escrow_qtd,
    v_sub_coins, v_sub_voucher_shopee, v_sub_shopee_discount,
    v_sub_promo_cartao, v_sub_pix_discount,
    v_seller_discount
  FROM e;

  -- ============ WALLET ============
  -- Roteamento em PL/pgSQL espelho do loop em route.ts 483-565. Ordem:
  --   1) classificacao/kpi = 'ignorar' → pula
  --   2) kpi ∈ {receita_escrow, comissao, taxa, ads} → pula (outra fonte)
  --   3) duplica_com != '' AND duplica_com != 'shopee_escrow' → pula
  --   4) compensação (3 padrões) → se amount>0, acumula e pula
  --   5) roteamento por kpi_destino (débito/crédito separados p/ afiliados,
  --      fbs e outros; saque só amount<0; demais SUM ABS)
  FOR r IN
    SELECT
      w.transaction_type,
      w.amount,
      w.description,
      m.kpi_destino,
      m.classificacao,
      m.natureza,
      m.duplica_com,
      (m.transaction_type IS NOT NULL) AS is_mapped
    FROM shopee_wallet w
    LEFT JOIN shopee_transaction_mapping m
      ON w.transaction_type = m.transaction_type
    WHERE w.shop_id = p_shop_id
      AND w.create_time >= v_start
      AND w.create_time < v_end
  LOOP
    -- (1) Explícitos 'ignorar' (tipo OU classificação).
    IF r.kpi_destino = 'ignorar' OR r.classificacao = 'ignorar' THEN
      CONTINUE;
    END IF;

    -- (2) Kpis contabilizados em outras fontes autoritativas.
    IF r.kpi_destino IN ('receita_escrow', 'comissao', 'taxa', 'ads') THEN
      CONTINUE;
    END IF;

    -- (3) Defensivo: duplica com fonte ≠ shopee_escrow (ex: shopee_ads_daily).
    IF r.duplica_com IS NOT NULL
       AND r.duplica_com != ''
       AND r.duplica_com != 'shopee_escrow' THEN
      CONTINUE;
    END IF;

    -- Derivados usados em múltiplos ramos.
    v_desc_lower := LOWER(COALESCE(r.description, ''));
    v_is_mapped := r.is_mapped;
    -- isCredito = mapping ? natureza='credito' : amount > 0  (API 505)
    v_is_credito := CASE
      WHEN v_is_mapped AND r.natureza = 'credito' THEN true
      WHEN v_is_mapped THEN false
      ELSE r.amount > 0
    END;

    -- (4) Compensações — 3 padrões (API 468-523):
    --   a) kpi_destino = 'compensacao'
    --   b) transaction_type vazio AND desc ~ 'objeto perdido|reembolso'
    --   c) transaction_type = 'ADJUSTMENT_ADD' AND desc ~ 'compensation|perdido|danificado|extraviado'
    v_is_compensacao := false;
    IF r.kpi_destino = 'compensacao' THEN
      v_is_compensacao := true;
    ELSIF COALESCE(r.transaction_type, '') = '' AND (
      v_desc_lower LIKE '%objeto perdido%' OR v_desc_lower LIKE '%reembolso%'
    ) THEN
      v_is_compensacao := true;
    ELSIF r.transaction_type = 'ADJUSTMENT_ADD' AND (
      v_desc_lower LIKE '%compensation%'
      OR v_desc_lower LIKE '%perdido%'
      OR v_desc_lower LIKE '%danificado%'
      OR v_desc_lower LIKE '%extraviado%'
    ) THEN
      v_is_compensacao := true;
    END IF;

    IF v_is_compensacao THEN
      IF r.amount > 0 THEN
        v_compensacoes := v_compensacoes + r.amount;
        v_compensacoes_qtd := v_compensacoes_qtd + 1;
      END IF;
      CONTINUE;
    END IF;

    -- (5) Roteamento por kpi_destino — tipos não mapeados caem no ELSE (outros).
    IF r.kpi_destino = 'afiliados' THEN
      IF v_is_credito OR r.amount > 0 THEN
        v_afil_cre := v_afil_cre + ABS(r.amount);
      ELSE
        v_afil_deb := v_afil_deb + ABS(r.amount);
      END IF;

    ELSIF r.kpi_destino = 'devolucao' THEN
      v_dev_wallet_total := v_dev_wallet_total + ABS(r.amount);
      v_dev_wallet_qtd := v_dev_wallet_qtd + 1;

    ELSIF r.kpi_destino = 'difal' THEN
      v_difal := v_difal + ABS(r.amount);
      v_difal_qtd := v_difal_qtd + 1;

    ELSIF r.kpi_destino = 'pedidos_negativos' THEN
      v_ped_neg_wallet := v_ped_neg_wallet + ABS(r.amount);
      v_ped_neg_wallet_qtd := v_ped_neg_wallet_qtd + 1;

    ELSIF r.kpi_destino = 'fbs' THEN
      IF v_is_credito OR r.amount > 0 THEN
        v_fbs_cre := v_fbs_cre + ABS(r.amount);
      ELSE
        v_fbs_deb := v_fbs_deb + ABS(r.amount);
      END IF;

    ELSIF r.kpi_destino = 'saque' THEN
      -- Só conta quando saiu dinheiro (sem olhar natureza, paridade API 540-545).
      IF r.amount < 0 THEN
        v_saques := v_saques + ABS(r.amount);
        v_saques_qtd := v_saques_qtd + 1;
      END IF;

    ELSE
      -- Default 'outros': mapeados kpi='outros' + NÃO mapeados (m IS NULL)
      -- + qualquer kpi_destino que não caiu nos ramos acima. Sem filtro
      -- de entra_no_custo_total — API 546-564 conta tudo.
      IF v_is_credito OR r.amount > 0 THEN
        v_outros_cre := v_outros_cre + ABS(r.amount);
      ELSE
        v_outros_deb := v_outros_deb + ABS(r.amount);
      END IF;
    END IF;
  END LOOP;

  -- ============ ADS ============
  SELECT COALESCE(SUM(expense), 0),
         COALESCE(SUM(broad_gmv), 0)
    INTO v_ads_expense, v_ads_broad_gmv
  FROM shopee_ads_daily
  WHERE shop_id = p_shop_id
    AND date = p_data;

  -- ============ MÉDIA DIAS PAGAMENTO ============
  -- Cruza escrow liberado no dia × pedidos com pay_time. Só diff >= 0.
  SELECT
    COALESCE(SUM(EXTRACT(EPOCH FROM (e.escrow_release_time - p.pay_time)) / 86400.0), 0),
    COUNT(*)
  INTO v_dias_soma, v_dias_count
  FROM shopee_escrow e
  JOIN shopee_pedidos p
    ON e.shop_id = p.shop_id
   AND e.order_sn = p.order_sn
  WHERE e.shop_id = p_shop_id
    AND e.is_released = true
    AND e.escrow_release_time >= v_start
    AND e.escrow_release_time < v_end
    AND p.pay_time IS NOT NULL
    AND e.escrow_release_time >= p.pay_time;

  -- ============ UPSERT ============
  INSERT INTO shopee_financeiro_daily_stats (
    data, shop_id,
    gmv, receita_liquida, total_pedidos,
    count_with_detail, escrows_com_detail, escrows_sem_detail,
    order_selling_price_total, order_discounted_price_total,
    comissao, taxa_servico, seller_transaction_fee,
    ads_expense, ads_broad_gmv,
    afiliados_escrow, afiliados_wallet_debito, afiliados_wallet_credito,
    cupons_seller,
    devolucoes_frete_reverso, devolucoes_frete_ida, devolucoes_qtd, devolucoes_reversao,
    fbs_escrow,
    pedidos_negativos_escrow, pedidos_negativos_escrow_qtd,
    difal, difal_qtd,
    fbs_wallet_debito, fbs_wallet_credito,
    pedidos_negativos_wallet, pedidos_negativos_wallet_qtd,
    devolucao_total_wallet, devolucao_qtd_wallet,
    outros_debito, outros_credito,
    subsidio_coins, subsidio_voucher_shopee, subsidio_shopee_discount,
    subsidio_promo_cartao, subsidio_pix_discount,
    compensacoes_total, compensacoes_qtd,
    saques, saques_qtd,
    dias_pagamento_soma, dias_pagamento_count,
    seller_discount_total,
    updated_at
  ) VALUES (
    p_data, p_shop_id,
    v_gmv, v_receita_liquida, v_total_pedidos,
    v_count_detail, v_count_detail, GREATEST(0, v_total_pedidos - v_count_detail),
    v_osp_total, v_odp_total,
    v_comissao, v_taxa_servico, v_seller_tx_fee,
    v_ads_expense, v_ads_broad_gmv,
    v_afiliados_escrow, v_afil_deb, v_afil_cre,
    v_cupons_seller,
    v_dev_frete_reverso, v_dev_frete_ida, v_dev_qtd, v_dev_reversao,
    v_fbs_escrow,
    v_ped_neg_escrow, v_ped_neg_escrow_qtd,
    v_difal, v_difal_qtd,
    v_fbs_deb, v_fbs_cre,
    v_ped_neg_wallet, v_ped_neg_wallet_qtd,
    v_dev_wallet_total, v_dev_wallet_qtd,
    v_outros_deb, v_outros_cre,
    v_sub_coins, v_sub_voucher_shopee, v_sub_shopee_discount,
    v_sub_promo_cartao, v_sub_pix_discount,
    v_compensacoes, v_compensacoes_qtd,
    v_saques, v_saques_qtd,
    v_dias_soma, v_dias_count,
    v_seller_discount,
    NOW()
  )
  ON CONFLICT (data, shop_id) DO UPDATE SET
    gmv = EXCLUDED.gmv,
    receita_liquida = EXCLUDED.receita_liquida,
    total_pedidos = EXCLUDED.total_pedidos,
    count_with_detail = EXCLUDED.count_with_detail,
    escrows_com_detail = EXCLUDED.escrows_com_detail,
    escrows_sem_detail = EXCLUDED.escrows_sem_detail,
    order_selling_price_total = EXCLUDED.order_selling_price_total,
    order_discounted_price_total = EXCLUDED.order_discounted_price_total,
    comissao = EXCLUDED.comissao,
    taxa_servico = EXCLUDED.taxa_servico,
    seller_transaction_fee = EXCLUDED.seller_transaction_fee,
    ads_expense = EXCLUDED.ads_expense,
    ads_broad_gmv = EXCLUDED.ads_broad_gmv,
    afiliados_escrow = EXCLUDED.afiliados_escrow,
    afiliados_wallet_debito = EXCLUDED.afiliados_wallet_debito,
    afiliados_wallet_credito = EXCLUDED.afiliados_wallet_credito,
    cupons_seller = EXCLUDED.cupons_seller,
    devolucoes_frete_reverso = EXCLUDED.devolucoes_frete_reverso,
    devolucoes_frete_ida = EXCLUDED.devolucoes_frete_ida,
    devolucoes_qtd = EXCLUDED.devolucoes_qtd,
    devolucoes_reversao = EXCLUDED.devolucoes_reversao,
    fbs_escrow = EXCLUDED.fbs_escrow,
    pedidos_negativos_escrow = EXCLUDED.pedidos_negativos_escrow,
    pedidos_negativos_escrow_qtd = EXCLUDED.pedidos_negativos_escrow_qtd,
    difal = EXCLUDED.difal,
    difal_qtd = EXCLUDED.difal_qtd,
    fbs_wallet_debito = EXCLUDED.fbs_wallet_debito,
    fbs_wallet_credito = EXCLUDED.fbs_wallet_credito,
    pedidos_negativos_wallet = EXCLUDED.pedidos_negativos_wallet,
    pedidos_negativos_wallet_qtd = EXCLUDED.pedidos_negativos_wallet_qtd,
    devolucao_total_wallet = EXCLUDED.devolucao_total_wallet,
    devolucao_qtd_wallet = EXCLUDED.devolucao_qtd_wallet,
    outros_debito = EXCLUDED.outros_debito,
    outros_credito = EXCLUDED.outros_credito,
    subsidio_coins = EXCLUDED.subsidio_coins,
    subsidio_voucher_shopee = EXCLUDED.subsidio_voucher_shopee,
    subsidio_shopee_discount = EXCLUDED.subsidio_shopee_discount,
    subsidio_promo_cartao = EXCLUDED.subsidio_promo_cartao,
    subsidio_pix_discount = EXCLUDED.subsidio_pix_discount,
    compensacoes_total = EXCLUDED.compensacoes_total,
    compensacoes_qtd = EXCLUDED.compensacoes_qtd,
    saques = EXCLUDED.saques,
    saques_qtd = EXCLUDED.saques_qtd,
    dias_pagamento_soma = EXCLUDED.dias_pagamento_soma,
    dias_pagamento_count = EXCLUDED.dias_pagamento_count,
    seller_discount_total = EXCLUDED.seller_discount_total,
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION refresh_shopee_financeiro_daily(DATE, BIGINT) IS
  'Recomputa uma única (data, shop_id) em shopee_financeiro_daily_stats. Idempotente via ON CONFLICT. Paridade 100% com src/app/api/shopee/financeiro/route.ts.';
