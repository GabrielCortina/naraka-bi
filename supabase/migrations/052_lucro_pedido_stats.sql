-- ============================================================
-- 052_lucro_pedido_stats.sql
--
-- Summary por pedido com lucro/prejuízo pré-calculado. Base para
-- a aba Lucro e Prejuízo. 1 linha por (order_sn, shop_id).
--
-- Componentes fixos são armazenados (venda, CMV, comissão, etc.).
-- Rateios dinâmicos (ads, FBS) são calculados na hora pela API de
-- consulta, porque dependem de seleção de período e toggles.
--
-- ETAPA 2: CREATE TABLE + CREATE FUNCTION de refresh.
-- Não cria cron, não altera API. Cron virá em refresh-lucro route.
--
-- Fontes:
--   - shopee_escrow: receita, taxas, comissões, afiliado, fretes
--   - shopee_wallet (ADJUSTMENT_CENTER_DEDUCT): DIFAL por pedido
--   - shopee_conciliacao + pedidos + pedido_itens: itens/SKUs
--   - sku_custo: CMV resolvido via (sku_pai, tamanho, vigência)
--   - shopee_pedidos: order_status
--
-- Conversão BRT:
--   dia em BRT = [YYYY-MM-DD 03:00:00+00, YYYY-MM-DD+1 03:00:00+00)
-- ============================================================


-- ============================================================
-- 1. TABELA SUMMARY (1 linha por pedido)
-- ============================================================

CREATE TABLE IF NOT EXISTS lucro_pedido_stats (
  order_sn TEXT NOT NULL,
  shop_id BIGINT NOT NULL,

  -- Datas
  data_liberacao DATE NOT NULL,              -- escrow_release_time convertido p/ BRT

  -- Receita
  venda NUMERIC DEFAULT 0,                   -- order_selling_price
  receita_liquida NUMERIC DEFAULT 0,         -- escrow_amount (comissão/taxa já descontadas)

  -- Custos diretos do escrow (mantidos separados para toggles na UI)
  comissao NUMERIC DEFAULT 0,                -- commission_fee
  taxa_servico NUMERIC DEFAULT 0,            -- service_fee
  afiliado NUMERIC DEFAULT 0,                -- order_ams_commission_fee
  cupom_seller NUMERIC DEFAULT 0,            -- voucher_from_seller
  frete_reverso NUMERIC DEFAULT 0,           -- reverse_shipping_fee
  frete_ida_seller NUMERIC DEFAULT 0,        -- actual_shipping_fee quando seller paga ida em devolução

  -- DIFAL (extraído da wallet por order_sn via regex na description)
  difal NUMERIC DEFAULT 0,

  -- CMV (sku_custo × pedido_itens)
  cmv NUMERIC DEFAULT 0,                     -- SUM(custo_unitario × quantidade)
  tem_cmv BOOLEAN DEFAULT false,             -- true se pelo menos 1 item tem custo cadastrado

  -- SKUs do pedido
  skus TEXT[] DEFAULT '{}',                  -- ex: {"90909P-G","90909P-GG"}
  sku_pais TEXT[] DEFAULT '{}',              -- ex: {"90909"}
  qtd_itens INT DEFAULT 0,

  -- Lucros pré-calculados (sem rateio — rateios ads/fbs vêm da API)
  lucro_bruto NUMERIC DEFAULT 0,             -- venda - cmv
  lucro_operacional NUMERIC DEFAULT 0,       -- receita_liquida - cmv
  margem_bruta_pct NUMERIC DEFAULT 0,
  margem_operacional_pct NUMERIC DEFAULT 0,

  -- Info do pedido
  metodo_pagamento TEXT,
  status_pedido TEXT,
  tem_devolucao BOOLEAN DEFAULT false,
  tem_afiliado BOOLEAN DEFAULT false,

  -- Breakdown (% de cada custo sobre a venda)
  cmv_pct NUMERIC DEFAULT 0,
  comissao_pct NUMERIC DEFAULT 0,
  taxa_pct NUMERIC DEFAULT 0,
  afiliado_pct NUMERIC DEFAULT 0,

  -- Classificação derivada (saudavel/atencao/prejuizo/sem_cmv)
  status TEXT DEFAULT 'sem_cmv',

  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (order_sn, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_lucro_pedido_data
  ON lucro_pedido_stats (data_liberacao, shop_id);

CREATE INDEX IF NOT EXISTS idx_lucro_pedido_sku
  ON lucro_pedido_stats USING GIN (sku_pais);

CREATE INDEX IF NOT EXISTS idx_lucro_pedido_status
  ON lucro_pedido_stats (status, shop_id);

GRANT SELECT ON lucro_pedido_stats TO anon, authenticated;

COMMENT ON TABLE lucro_pedido_stats IS
  'Summary por pedido (order_sn × shop_id) com lucro/prejuízo pré-calculado. Componentes fixos (venda, CMV, comissão, DIFAL etc.) são armazenados. Rateios ads/FBS são calculados na hora pela API /api/lucro porque dependem de período e toggles.';


-- ============================================================
-- 2. HELPER: resolve CMV para um SKU em uma data
-- ============================================================
-- Replica src/lib/cmv.ts:
--   - sku_pai: prefixo numérico do SKU ("90909P-G" → "90909")
--   - tamanho: parte após o último hífen ("90909P-G" → "G")
--   - faixa específica com match de tamanho vence 'unico'
--   - faixa 'unico' é fallback
--   - múltiplas vigências: pega a que cobre a data (inicio ≤ data ≤ fim|NULL)
-- Retorna 0 se nada bater — nunca bloqueia o cálculo de lucro.

CREATE OR REPLACE FUNCTION resolve_cmv_for_sku(
  p_sku TEXT,
  p_data DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_sku_pai TEXT;
  v_tamanho TEXT;
  v_custo NUMERIC;
  v_last_hyphen INT;
BEGIN
  IF p_sku IS NULL THEN RETURN 0; END IF;

  v_sku_pai := substring(p_sku FROM '^(\d+)');
  IF v_sku_pai IS NULL THEN RETURN 0; END IF;

  -- Tamanho = parte após o último hífen (se existir e não for o último char)
  v_last_hyphen := length(p_sku) - position('-' IN reverse(p_sku));
  IF v_last_hyphen >= 0 AND v_last_hyphen < length(p_sku) - 1 THEN
    v_tamanho := substring(p_sku FROM v_last_hyphen + 2);
  ELSE
    v_tamanho := NULL;
  END IF;

  -- 1) Faixa específica (regular/plus) com match exato de tamanho
  IF v_tamanho IS NOT NULL THEN
    SELECT custo_unitario INTO v_custo
    FROM sku_custo
    WHERE sku_pai = v_sku_pai
      AND faixa IN ('regular','plus')
      AND v_tamanho = ANY(tamanhos)
      AND vigencia_inicio <= p_data
      AND (vigencia_fim IS NULL OR vigencia_fim >= p_data)
    ORDER BY vigencia_inicio DESC
    LIMIT 1;

    IF v_custo IS NOT NULL THEN RETURN v_custo; END IF;
  END IF;

  -- 2) Fallback 'unico'
  SELECT custo_unitario INTO v_custo
  FROM sku_custo
  WHERE sku_pai = v_sku_pai
    AND faixa = 'unico'
    AND vigencia_inicio <= p_data
    AND (vigencia_fim IS NULL OR vigencia_fim >= p_data)
  ORDER BY vigencia_inicio DESC
  LIMIT 1;

  RETURN COALESCE(v_custo, 0);
END;
$$;

COMMENT ON FUNCTION resolve_cmv_for_sku(TEXT, DATE) IS
  'Resolve o CMV (custo unitário) de um SKU em uma data específica. Replica a lógica de src/lib/cmv.ts. Retorna 0 se não houver cadastro — nunca bloqueia cálculo.';


-- ============================================================
-- 3. FUNÇÃO DE REFRESH — recomputa (data, shop_id)
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_lucro_pedido_stats(
  p_data DATE,
  p_shop_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ := (p_data::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;
  v_end   TIMESTAMPTZ := ((p_data + 1)::TEXT || ' 03:00:00+00')::TIMESTAMPTZ;
BEGIN

  -- Remove rows obsoletas deste dia:
  -- (a) order_sn que não está mais entre os escrows liberados em p_data
  -- (ex: escrow_release_time foi reajustado pela Shopee para outro dia).
  -- Mantém quem ainda pertence — os valores serão atualizados pelo UPSERT.
  DELETE FROM lucro_pedido_stats lps
  WHERE lps.shop_id = p_shop_id
    AND lps.data_liberacao = p_data
    AND NOT EXISTS (
      SELECT 1 FROM shopee_escrow e
      WHERE e.shop_id = p_shop_id
        AND e.order_sn = lps.order_sn
        AND e.is_released = true
        AND e.escrow_release_time >= v_start
        AND e.escrow_release_time < v_end
    );

  -- UPSERT todos os pedidos liberados em p_data.
  -- Usa CTEs em cascata:
  --   escrows       → base (1 linha por pedido do dia)
  --   difal_map     → wallet DIFAL do dia agrupada por order_sn
  --   itens_via_conc→ pedido_itens via shopee_conciliacao.tiny_pedido_id
  --   itens_direto  → fallback via pedidos.numero_pedido_ecommerce
  --   itens_all     → união sem duplicar (conciliação ganha)
  --   itens_cmv     → resolve custo por item (função helper)
  --   itens_agg     → agrega SKUs/qtd/cmv/tem_cmv por order_sn
  --   stats_pedido  → cruza tudo e monta cada linha final
  INSERT INTO lucro_pedido_stats AS lps (
    order_sn, shop_id, data_liberacao,
    venda, receita_liquida,
    comissao, taxa_servico, afiliado, cupom_seller,
    frete_reverso, frete_ida_seller,
    difal,
    cmv, tem_cmv,
    skus, sku_pais, qtd_itens,
    lucro_bruto, lucro_operacional,
    margem_bruta_pct, margem_operacional_pct,
    metodo_pagamento, status_pedido,
    tem_devolucao, tem_afiliado,
    cmv_pct, comissao_pct, taxa_pct, afiliado_pct,
    status,
    updated_at
  )
  WITH escrows AS (
    SELECT
      e.order_sn,
      COALESCE(e.order_selling_price, 0) AS venda,
      COALESCE(e.escrow_amount, 0)       AS receita_liquida,
      COALESCE(e.commission_fee, 0)      AS comissao,
      COALESCE(e.service_fee, 0)         AS taxa_servico,
      COALESCE(e.order_ams_commission_fee, 0) AS afiliado,
      COALESCE(e.voucher_from_seller, 0) AS cupom_seller,
      COALESCE(e.reverse_shipping_fee, 0) AS frete_reverso,
      -- frete ida pelo seller: só quando reverse>0 AND rebate=0 AND actual>0
      -- (mesma regra do summary financeiro)
      CASE
        WHEN COALESCE(e.reverse_shipping_fee, 0) > 0
         AND COALESCE(e.shopee_shipping_rebate, 0) = 0
         AND COALESCE(e.actual_shipping_fee, 0) > 0
        THEN e.actual_shipping_fee
        ELSE 0
      END AS frete_ida_seller,
      e.buyer_payment_method
    FROM shopee_escrow e
    WHERE e.shop_id = p_shop_id
      AND e.is_released = true
      AND e.escrow_release_time >= v_start
      AND e.escrow_release_time < v_end
  ),
  difal_map AS (
    SELECT
      substring(w.description FROM 'referente ao pedido\s+(\S+)\s*$') AS order_sn,
      SUM(ABS(w.amount)) AS difal_total
    FROM shopee_wallet w
    WHERE w.shop_id = p_shop_id
      AND w.transaction_type = 'ADJUSTMENT_CENTER_DEDUCT'
      AND w.create_time >= v_start
      AND w.create_time < v_end
      AND w.description ~ 'referente ao pedido\s+(\S+)\s*$'
    GROUP BY substring(w.description FROM 'referente ao pedido\s+(\S+)\s*$')
  ),
  itens_via_conc AS (
    SELECT
      c.order_sn,
      pi.sku,
      pi.quantidade,
      p.data_pedido
    FROM shopee_conciliacao c
    JOIN pedidos p ON p.id = c.tiny_pedido_id
    JOIN pedido_itens pi ON pi.pedido_id = p.id
    WHERE c.shop_id = p_shop_id
      AND c.tiny_pedido_id IS NOT NULL
      AND c.order_sn IN (SELECT order_sn FROM escrows)
  ),
  itens_direto AS (
    SELECT
      p.numero_pedido_ecommerce AS order_sn,
      pi.sku,
      pi.quantidade,
      p.data_pedido
    FROM pedidos p
    JOIN pedido_itens pi ON pi.pedido_id = p.id
    WHERE p.numero_pedido_ecommerce IN (SELECT order_sn FROM escrows)
      AND p.numero_pedido_ecommerce NOT IN (SELECT order_sn FROM itens_via_conc)
  ),
  itens_all AS (
    SELECT order_sn, sku, quantidade, data_pedido FROM itens_via_conc
    UNION ALL
    SELECT order_sn, sku, quantidade, data_pedido FROM itens_direto
  ),
  itens_cmv AS (
    SELECT
      i.order_sn,
      i.sku,
      i.quantidade,
      resolve_cmv_for_sku(i.sku, i.data_pedido) AS custo_unit
    FROM itens_all i
  ),
  itens_agg AS (
    SELECT
      order_sn,
      array_agg(DISTINCT sku ORDER BY sku) AS skus,
      array_remove(
        array_agg(DISTINCT substring(sku FROM '^(\d+)')
                  ORDER BY substring(sku FROM '^(\d+)')),
        NULL
      ) AS sku_pais,
      SUM(quantidade)::INT AS qtd_itens,
      SUM(custo_unit * quantidade) AS cmv,
      BOOL_OR(custo_unit > 0) AS tem_cmv
    FROM itens_cmv
    GROUP BY order_sn
  )
  SELECT
    e.order_sn,
    p_shop_id,
    p_data,
    e.venda,
    e.receita_liquida,
    e.comissao,
    e.taxa_servico,
    e.afiliado,
    e.cupom_seller,
    e.frete_reverso,
    e.frete_ida_seller,
    COALESCE(d.difal_total, 0)                                                   AS difal,
    COALESCE(ia.cmv, 0)                                                          AS cmv,
    COALESCE(ia.tem_cmv, false)                                                  AS tem_cmv,
    COALESCE(ia.skus, '{}'::TEXT[])                                              AS skus,
    COALESCE(ia.sku_pais, '{}'::TEXT[])                                          AS sku_pais,
    COALESCE(ia.qtd_itens, 0)                                                    AS qtd_itens,
    e.venda - COALESCE(ia.cmv, 0)                                                AS lucro_bruto,
    e.receita_liquida - COALESCE(ia.cmv, 0)                                      AS lucro_operacional,
    CASE WHEN e.venda > 0
         THEN (e.venda - COALESCE(ia.cmv, 0)) / e.venda * 100
         ELSE 0 END                                                              AS margem_bruta_pct,
    CASE WHEN e.venda > 0
         THEN (e.receita_liquida - COALESCE(ia.cmv, 0)) / e.venda * 100
         ELSE 0 END                                                              AS margem_operacional_pct,
    e.buyer_payment_method                                                       AS metodo_pagamento,
    sp.order_status                                                              AS status_pedido,
    e.frete_reverso > 0                                                          AS tem_devolucao,
    e.afiliado > 0                                                               AS tem_afiliado,
    CASE WHEN e.venda > 0 THEN COALESCE(ia.cmv, 0) / e.venda * 100 ELSE 0 END    AS cmv_pct,
    CASE WHEN e.venda > 0 THEN e.comissao / e.venda * 100 ELSE 0 END             AS comissao_pct,
    CASE WHEN e.venda > 0 THEN e.taxa_servico / e.venda * 100 ELSE 0 END         AS taxa_pct,
    CASE WHEN e.venda > 0 THEN e.afiliado / e.venda * 100 ELSE 0 END             AS afiliado_pct,
    CASE
      WHEN NOT COALESCE(ia.tem_cmv, false) THEN 'sem_cmv'
      WHEN e.venda <= 0 THEN 'atencao'
      WHEN ((e.receita_liquida - COALESCE(ia.cmv, 0)) / e.venda * 100) < 0 THEN 'prejuizo'
      WHEN ((e.receita_liquida - COALESCE(ia.cmv, 0)) / e.venda * 100) >= 15 THEN 'saudavel'
      ELSE 'atencao'
    END                                                                          AS status,
    NOW()                                                                        AS updated_at
  FROM escrows e
  LEFT JOIN difal_map d   ON d.order_sn = e.order_sn
  LEFT JOIN itens_agg ia  ON ia.order_sn = e.order_sn
  LEFT JOIN shopee_pedidos sp
         ON sp.shop_id = p_shop_id AND sp.order_sn = e.order_sn
  ON CONFLICT (order_sn, shop_id) DO UPDATE SET
    data_liberacao         = EXCLUDED.data_liberacao,
    venda                  = EXCLUDED.venda,
    receita_liquida        = EXCLUDED.receita_liquida,
    comissao               = EXCLUDED.comissao,
    taxa_servico           = EXCLUDED.taxa_servico,
    afiliado               = EXCLUDED.afiliado,
    cupom_seller           = EXCLUDED.cupom_seller,
    frete_reverso          = EXCLUDED.frete_reverso,
    frete_ida_seller       = EXCLUDED.frete_ida_seller,
    difal                  = EXCLUDED.difal,
    cmv                    = EXCLUDED.cmv,
    tem_cmv                = EXCLUDED.tem_cmv,
    skus                   = EXCLUDED.skus,
    sku_pais               = EXCLUDED.sku_pais,
    qtd_itens              = EXCLUDED.qtd_itens,
    lucro_bruto            = EXCLUDED.lucro_bruto,
    lucro_operacional      = EXCLUDED.lucro_operacional,
    margem_bruta_pct       = EXCLUDED.margem_bruta_pct,
    margem_operacional_pct = EXCLUDED.margem_operacional_pct,
    metodo_pagamento       = EXCLUDED.metodo_pagamento,
    status_pedido          = EXCLUDED.status_pedido,
    tem_devolucao          = EXCLUDED.tem_devolucao,
    tem_afiliado           = EXCLUDED.tem_afiliado,
    cmv_pct                = EXCLUDED.cmv_pct,
    comissao_pct           = EXCLUDED.comissao_pct,
    taxa_pct               = EXCLUDED.taxa_pct,
    afiliado_pct           = EXCLUDED.afiliado_pct,
    status                 = EXCLUDED.status,
    updated_at             = NOW();
END;
$$;

COMMENT ON FUNCTION refresh_lucro_pedido_stats(DATE, BIGINT) IS
  'Recomputa todas as linhas de lucro_pedido_stats para (data, shop_id). Processa em batch via CTEs (escrows, DIFAL wallet, itens via conciliação/direto, CMV por SKU). Idempotente via ON CONFLICT.';
