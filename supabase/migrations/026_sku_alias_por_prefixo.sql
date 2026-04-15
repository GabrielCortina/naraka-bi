-- ============================================================
-- 026_sku_alias_por_prefixo.sql
--
-- Correção: alias agora casa pelo PREFIXO NUMÉRICO (sku_pai) do
-- SKU, não pelo SKU completo. Assim "70006-36" (ML) e "7006-36"
-- (Shopee) colapsam sob o mesmo sku_pai quando há alias
-- 70006 → 7006 cadastrado.
--
-- O SKU em `variacoes` e no modal continua sendo o original da
-- variação (preserva identidade de tamanho/cor). Apenas o
-- agrupamento (sku_pai) passa a usar o canônico.
-- ============================================================

DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);

-- ============================================================
-- rpc_top_skus v4 (alias por prefixo)
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_top_skus(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku_pai      TEXT,
  faturamento  NUMERIC,
  pecas        NUMERIC,
  pedidos      BIGINT,
  variacoes    TEXT[]
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  itens_brutos AS (
    SELECT
      pi.pedido_id,
      pi.sku,
      pi.quantidade::NUMERIC  AS quantidade,
      pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  kit_componentes AS (
    SELECT
      sk.sku_kit,
      sk.sku_componente,
      sk.quantidade,
      COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT
      ib.pedido_id,
      kc.sku_componente                          AS sku_step,
      (ib.quantidade * kc.quantidade)::NUMERIC   AS quantidade,
      (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT
      ib.pedido_id, ib.sku, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    WHERE NOT EXISTS (SELECT 1 FROM kit_componentes kc WHERE kc.sku_kit = ib.sku)
  ),
  -- Alias casa pelo prefixo numérico do SKU (sku_pai do step)
  itens_normalizados AS (
    SELECT
      ke.pedido_id,
      ke.sku_step AS sku,
      ke.quantidade,
      ke.valor_total,
      COALESCE(
        substring(sa.sku_canonico FROM '^[0-9]+'),
        sa.sku_canonico,
        substring(ke.sku_step FROM '^[0-9]+'),
        ke.sku_step
      ) AS sku_pai
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = COALESCE(substring(ke.sku_step FROM '^[0-9]+'), ke.sku_step)
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  )
  SELECT
    sku_pai,
    SUM(valor_total)::NUMERIC             AS faturamento,
    SUM(quantidade)::NUMERIC              AS pecas,
    COUNT(DISTINCT pedido_id)::BIGINT     AS pedidos,
    array_agg(DISTINCT sku ORDER BY sku)  AS variacoes
  FROM itens_normalizados
  GROUP BY sku_pai
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_sku_detalhes v4 (alias por prefixo)
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_sku_detalhes(
  p_sku_pai TEXT,
  p_start   DATE,
  p_end     DATE,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku          TEXT,
  descricao    TEXT,
  quantidade   NUMERIC,
  faturamento  NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  itens_brutos AS (
    SELECT
      pi.pedido_id,
      pi.sku,
      pi.descricao,
      pi.quantidade::NUMERIC  AS quantidade,
      pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  kit_componentes AS (
    SELECT
      sk.sku_kit,
      sk.sku_componente,
      sk.quantidade,
      COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT
      ib.pedido_id,
      kc.sku_componente                          AS sku_step,
      ib.descricao,
      (ib.quantidade * kc.quantidade)::NUMERIC   AS quantidade,
      (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT
      ib.pedido_id, ib.sku, ib.descricao, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    WHERE NOT EXISTS (SELECT 1 FROM kit_componentes kc WHERE kc.sku_kit = ib.sku)
  ),
  itens_normalizados AS (
    SELECT
      ke.pedido_id,
      ke.sku_step AS sku,
      ke.descricao,
      ke.quantidade,
      ke.valor_total,
      COALESCE(
        substring(sa.sku_canonico FROM '^[0-9]+'),
        sa.sku_canonico,
        substring(ke.sku_step FROM '^[0-9]+'),
        ke.sku_step
      ) AS sku_pai
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = COALESCE(substring(ke.sku_step FROM '^[0-9]+'), ke.sku_step)
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  )
  SELECT
    inn.sku,
    MAX(inn.descricao)::TEXT      AS descricao,
    SUM(inn.quantidade)::NUMERIC  AS quantidade,
    SUM(inn.valor_total)::NUMERIC AS faturamento
  FROM itens_normalizados inn
  WHERE inn.sku_pai = p_sku_pai
  GROUP BY inn.sku
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- DOWN: reaplicar 025 para voltar ao lookup por SKU completo.
-- ============================================================
