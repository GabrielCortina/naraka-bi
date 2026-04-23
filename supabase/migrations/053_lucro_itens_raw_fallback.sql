-- ============================================================
-- 053_lucro_itens_raw_fallback.sql
--
-- 38% dos pedidos Shopee não têm vínculo com Tiny (nem via
-- shopee_conciliacao nem via pedidos.numero_pedido_ecommerce) —
-- sem itens, o CMV fica = 0 e o lucro operacional fica inflado.
--
-- Os itens já existem no shopee_escrow.raw_json->'order_income'->'items'.
-- Esta migration:
--   1) Adiciona uma 3ª fonte de itens ao refresh_lucro_pedido_stats
--      (raw_json) — só é consultada quando as 2 primeiras não acharam.
--   2) Atualiza resolve_cmv_for_sku para ignorar prefixos KIT/KITPC
--      antes de extrair sku_pai (SKUs Shopee vêm como "KIT90909..." às
--      vezes).
-- ============================================================


-- ============================================================
-- 1. resolve_cmv_for_sku — strip de prefixo KIT/KITPC
-- ============================================================

CREATE OR REPLACE FUNCTION resolve_cmv_for_sku(
  p_sku TEXT,
  p_data DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_stripped TEXT;
  v_sku_pai TEXT;
  v_tamanho TEXT;
  v_custo NUMERIC;
  v_last_hyphen INT;
BEGIN
  IF p_sku IS NULL THEN RETURN 0; END IF;

  -- Remove prefixo KITPC ou KIT (case-insensitive) — necessário para
  -- casar o sku_pai quando o SKU veio da fonte raw_json do escrow.
  v_stripped := regexp_replace(p_sku, '^(KITPC|KIT)', '', 'i');

  v_sku_pai := substring(v_stripped FROM '^(\d+)');
  IF v_sku_pai IS NULL THEN RETURN 0; END IF;

  -- Tamanho = parte após último hífen (aplica sobre SKU original)
  v_last_hyphen := length(p_sku) - position('-' IN reverse(p_sku));
  IF v_last_hyphen >= 0 AND v_last_hyphen < length(p_sku) - 1 THEN
    v_tamanho := substring(p_sku FROM v_last_hyphen + 2);
  ELSE
    v_tamanho := NULL;
  END IF;

  -- Faixa específica (regular/plus) com match exato de tamanho
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

  -- Fallback 'unico'
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


-- ============================================================
-- 2. refresh_lucro_pedido_stats — adiciona itens_via_raw
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

  -- Remove rows obsoletas deste dia (escrow_release_time mudou).
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
  -- Fontes de itens em ordem de prioridade:
  --   1) shopee_conciliacao.tiny_pedido_id → pedidos → pedido_itens (Tiny)
  --   2) pedidos.numero_pedido_ecommerce = order_sn → pedido_itens (Tiny direto)
  --   3) shopee_escrow.raw_json->'order_income'->'items' (Shopee raw — novo)
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
  -- NOVO: fallback raw_json — só para order_sn que as 2 fontes Tiny não cobriram.
  -- LATERAL + filtro jsonb_typeof = 'array' evita erro em escrows sem raw_json
  -- ou com formato inesperado. model_sku é a chave canônica; item_sku é fallback.
  -- Quantidade default = 1 quando quantity_purchased estiver ausente/inválido.
  itens_via_raw AS (
    SELECT
      e.order_sn,
      COALESCE(NULLIF(item->>'model_sku', ''), item->>'item_sku') AS sku,
      COALESCE(NULLIF(item->>'quantity_purchased','')::INT, 1)    AS quantidade,
      p_data AS data_pedido
    FROM shopee_escrow e
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(e.raw_json->'order_income'->'items') = 'array'
           THEN e.raw_json->'order_income'->'items'
           ELSE '[]'::jsonb
      END
    ) AS item
    WHERE e.shop_id = p_shop_id
      AND e.is_released = true
      AND e.escrow_release_time >= v_start
      AND e.escrow_release_time < v_end
      AND e.order_sn NOT IN (SELECT order_sn FROM itens_via_conc)
      AND e.order_sn NOT IN (SELECT order_sn FROM itens_direto)
      AND COALESCE(NULLIF(item->>'model_sku', ''), item->>'item_sku') IS NOT NULL
  ),
  itens_all AS (
    SELECT order_sn, sku, quantidade, data_pedido FROM itens_via_conc
    UNION ALL
    SELECT order_sn, sku, quantidade, data_pedido FROM itens_direto
    UNION ALL
    SELECT order_sn, sku, quantidade, data_pedido FROM itens_via_raw
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
        array_agg(DISTINCT substring(regexp_replace(sku, '^(KITPC|KIT)', '', 'i') FROM '^(\d+)')
                  ORDER BY substring(regexp_replace(sku, '^(KITPC|KIT)', '', 'i') FROM '^(\d+)')),
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
  'Recomputa todas as linhas de lucro_pedido_stats para (data, shop_id). 3 fontes de itens: (1) conciliacao→Tiny, (2) pedidos.numero_pedido_ecommerce→Tiny, (3) shopee_escrow.raw_json. Fallback raw_json cobre os ~38% de pedidos sem vínculo Tiny.';
