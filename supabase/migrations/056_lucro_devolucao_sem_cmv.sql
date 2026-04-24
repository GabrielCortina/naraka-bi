-- ============================================================
-- 056_lucro_devolucao_sem_cmv.sql
--
-- Em devolução TOTAL (pré-entrega), o produto volta pro estoque — o CMV
-- não deve ser subtraído do lucro. A migration 055 já corrigiu o sinal
-- de tem_devolucao; agora corrigimos o impacto financeiro.
--
-- Regra:
--   is_devolucao_total :=
--        venda = 0
--     AND (
--          seller_return_refund < 0
--       OR reverse_shipping_fee > 0
--       OR (receita_liquida <= 0 AND buyer_total_amount > 0)
--     )
--
--   Se is_devolucao_total:
--     lucro_bruto        = venda (= 0)
--     lucro_operacional  = receita_liquida  (já reflete fees residuais)
--     margens            = 0 (venda = 0 — evitamos divisão por zero)
--   Senão:
--     lucro_bruto        = venda - cmv
--     lucro_operacional  = receita_liquida - cmv
--     margens            = (lucro / venda) * 100
--
-- O campo cmv continua preenchido (usado no breakdown da UI); só não
-- entra no lucro_operacional quando o estoque voltou.
--
-- Status também passa a refletir lucro_operacional quando venda = 0:
--   lucro_operacional < 0 → 'prejuizo'
--   caso contrário        → 'atencao' (sem métrica de margem)
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

  -- Limpa rows obsoletas (escrow_release_time saiu desse dia).
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
    seller_return_refund,
    updated_at
  )
  WITH escrows AS (
    SELECT
      e.order_sn,
      COALESCE(e.order_selling_price, 0)      AS venda,
      COALESCE(e.escrow_amount, 0)            AS receita_liquida,
      COALESCE(e.commission_fee, 0)           AS comissao,
      COALESCE(e.service_fee, 0)              AS taxa_servico,
      COALESCE(e.order_ams_commission_fee, 0) AS afiliado,
      COALESCE(e.voucher_from_seller, 0)      AS cupom_seller,
      COALESCE(e.reverse_shipping_fee, 0)     AS frete_reverso,
      CASE
        WHEN COALESCE(e.reverse_shipping_fee, 0) > 0
         AND COALESCE(e.shopee_shipping_rebate, 0) = 0
         AND COALESCE(e.actual_shipping_fee, 0) > 0
        THEN e.actual_shipping_fee
        ELSE 0
      END                                     AS frete_ida_seller,
      e.buyer_payment_method,
      COALESCE(e.seller_return_refund, 0)     AS seller_return_refund,
      COALESCE(e.buyer_total_amount, 0)       AS buyer_total_amount,
      -- Devolução total: venda zerada + algum sinal de reversão. Nesse
      -- caso o CMV não deve ser subtraído (produto voltou pro estoque).
      (
        COALESCE(e.order_selling_price, 0) = 0
        AND (
          COALESCE(e.seller_return_refund, 0) < 0
          OR COALESCE(e.reverse_shipping_fee, 0) > 0
          OR (COALESCE(e.escrow_amount, 0) <= 0 AND COALESCE(e.buyer_total_amount, 0) > 0)
        )
      )                                       AS is_devolucao_total
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
  itens_all_raw AS (
    SELECT order_sn, sku, quantidade::NUMERIC AS quantidade, data_pedido FROM itens_via_conc
    UNION ALL
    SELECT order_sn, sku, quantidade::NUMERIC AS quantidade, data_pedido FROM itens_direto
    UNION ALL
    SELECT order_sn, sku, quantidade::NUMERIC AS quantidade, data_pedido FROM itens_via_raw
  ),
  kit_componentes AS (
    SELECT sk.sku_kit, sk.sku_componente, sk.quantidade
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  itens_expanded AS (
    SELECT
      i.order_sn,
      kc.sku_componente AS sku,
      (i.quantidade * kc.quantidade)::NUMERIC AS quantidade,
      i.data_pedido
    FROM itens_all_raw i
    JOIN kit_componentes kc ON kc.sku_kit = i.sku
    UNION ALL
    SELECT
      i.order_sn, i.sku, i.quantidade, i.data_pedido
    FROM itens_all_raw i
    WHERE NOT EXISTS (SELECT 1 FROM kit_componentes kc WHERE kc.sku_kit = i.sku)
  ),
  itens_cmv AS (
    SELECT
      i.order_sn,
      i.sku,
      i.quantidade,
      i.data_pedido,
      resolve_cmv_for_sku(i.sku, i.data_pedido) AS custo_unit
    FROM itens_expanded i
  ),
  itens_com_pai AS (
    SELECT
      ic.order_sn,
      ic.sku,
      ic.quantidade,
      ic.custo_unit,
      substring(regexp_replace(ic.sku, '^(KITPC|KIT)-?', '', 'i') FROM '^(\d+)') AS sku_pai_extraido
    FROM itens_cmv ic
  ),
  itens_aliased AS (
    SELECT
      icp.order_sn,
      icp.sku,
      icp.quantidade,
      icp.custo_unit,
      COALESCE(
        substring(sa.sku_canonico FROM '^[0-9]+'),
        sa.sku_canonico,
        icp.sku_pai_extraido
      ) AS sku_pai
    FROM itens_com_pai icp
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = icp.sku_pai_extraido
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  ),
  itens_agg AS (
    SELECT
      order_sn,
      array_agg(DISTINCT sku ORDER BY sku) AS skus,
      array_remove(array_agg(DISTINCT sku_pai ORDER BY sku_pai), NULL) AS sku_pais,
      SUM(quantidade)::INT AS qtd_itens,
      SUM(custo_unit * quantidade) AS cmv,
      BOOL_OR(custo_unit > 0) AS tem_cmv
    FROM itens_aliased
    GROUP BY order_sn
  ),
  -- Projeta os campos finais (lucro/margem/status) aplicando o tratamento
  -- de devolução total. Materializar aqui evita duplicar a lógica de CASE
  -- na lista de SELECT principal.
  computed AS (
    SELECT
      e.*,
      COALESCE(ia.cmv, 0)                                          AS cmv_v,
      COALESCE(ia.tem_cmv, false)                                  AS tem_cmv_v,
      COALESCE(ia.skus, '{}'::TEXT[])                              AS skus_v,
      COALESCE(ia.sku_pais, '{}'::TEXT[])                          AS sku_pais_v,
      COALESCE(ia.qtd_itens, 0)                                    AS qtd_itens_v,
      COALESCE(d.difal_total, 0)                                   AS difal_v,
      CASE
        WHEN e.is_devolucao_total THEN e.venda
        ELSE e.venda - COALESCE(ia.cmv, 0)
      END                                                          AS lucro_bruto_v,
      CASE
        WHEN e.is_devolucao_total THEN e.receita_liquida
        ELSE e.receita_liquida - COALESCE(ia.cmv, 0)
      END                                                          AS lucro_operacional_v
    FROM escrows e
    LEFT JOIN difal_map d  ON d.order_sn = e.order_sn
    LEFT JOIN itens_agg ia ON ia.order_sn = e.order_sn
  )
  SELECT
    c.order_sn,
    p_shop_id,
    p_data,
    c.venda,
    c.receita_liquida,
    c.comissao,
    c.taxa_servico,
    c.afiliado,
    c.cupom_seller,
    c.frete_reverso,
    c.frete_ida_seller,
    c.difal_v                                                                    AS difal,
    c.cmv_v                                                                      AS cmv,
    c.tem_cmv_v                                                                  AS tem_cmv,
    c.skus_v                                                                     AS skus,
    c.sku_pais_v                                                                 AS sku_pais,
    c.qtd_itens_v                                                                AS qtd_itens,
    c.lucro_bruto_v                                                              AS lucro_bruto,
    c.lucro_operacional_v                                                        AS lucro_operacional,
    CASE
      WHEN c.venda > 0 THEN (c.lucro_bruto_v / c.venda) * 100
      ELSE 0
    END                                                                          AS margem_bruta_pct,
    CASE
      WHEN c.venda > 0 THEN (c.lucro_operacional_v / c.venda) * 100
      ELSE 0
    END                                                                          AS margem_operacional_pct,
    c.buyer_payment_method                                                       AS metodo_pagamento,
    sp.order_status                                                              AS status_pedido,
    (
      c.frete_reverso > 0
      OR c.seller_return_refund < 0
      OR (c.venda = 0 AND c.receita_liquida <= 0 AND c.buyer_total_amount > 0)
    )                                                                            AS tem_devolucao,
    c.afiliado > 0                                                               AS tem_afiliado,
    CASE WHEN c.venda > 0 THEN c.cmv_v / c.venda * 100 ELSE 0 END                AS cmv_pct,
    CASE WHEN c.venda > 0 THEN c.comissao / c.venda * 100 ELSE 0 END             AS comissao_pct,
    CASE WHEN c.venda > 0 THEN c.taxa_servico / c.venda * 100 ELSE 0 END         AS taxa_pct,
    CASE WHEN c.venda > 0 THEN c.afiliado / c.venda * 100 ELSE 0 END             AS afiliado_pct,
    -- Status recalculado pós-nova lógica:
    --   sem_cmv sempre vence (não houve custo cadastrado)
    --   venda = 0: diz prejuízo se lucro_operacional < 0, senão atenção
    --              (sem base para calcular margem)
    --   venda > 0: usa margem_operacional_pct já com CMV condicional
    CASE
      WHEN NOT c.tem_cmv_v THEN 'sem_cmv'
      WHEN c.venda <= 0 THEN
        CASE WHEN c.lucro_operacional_v < 0 THEN 'prejuizo' ELSE 'atencao' END
      WHEN (c.lucro_operacional_v / c.venda * 100) < 0   THEN 'prejuizo'
      WHEN (c.lucro_operacional_v / c.venda * 100) >= 15 THEN 'saudavel'
      ELSE 'atencao'
    END                                                                          AS status,
    c.seller_return_refund                                                       AS seller_return_refund,
    NOW()                                                                        AS updated_at
  FROM computed c
  LEFT JOIN shopee_pedidos sp
         ON sp.shop_id = p_shop_id AND sp.order_sn = c.order_sn
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
    seller_return_refund   = EXCLUDED.seller_return_refund,
    updated_at             = NOW();
END;
$$;

COMMENT ON FUNCTION refresh_lucro_pedido_stats(DATE, BIGINT) IS
  'Recomputa lucro_pedido_stats para (data, shop_id). Devolução total (venda=0 + sinal de reversão) NÃO subtrai CMV do lucro — produto voltou pro estoque. cmv continua gravado para exibição. Devolução parcial e pedido normal seguem lucro = receita_liquida - cmv.';
