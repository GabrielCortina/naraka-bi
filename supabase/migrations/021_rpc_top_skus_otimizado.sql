-- ============================================================
-- 021_rpc_top_skus_otimizado.sql
--
-- Corrige "Top SKUs vazio em períodos longos" causado por
-- statement_timeout no anon role da Supabase.
--
-- Problemas da versão anterior (020):
--   1. Subquery correlata O(n²) no SELECT final contando
--      pedidos por sku_pai (rodava uma vez por linha).
--   2. jsonb_agg criando 'skus_filhos' por sku_pai com payload
--      grande — nem é consumido pela UI (modal usa getSkuDetalhes
--      separado).
--
-- Nova versão: single GROUP BY, sem JSONB, sem subquery correlata.
-- Tempo esperado para 30 dias: <500ms (antes estourava timeout).
-- ============================================================

DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);

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
  itens AS (
    SELECT
      pi.pedido_id,
      pi.sku,
      pi.quantidade,
      pi.valor_total,
      COALESCE(substring(pi.sku from '^[0-9]+'), pi.sku) AS sku_pai
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  )
  SELECT
    sku_pai,
    SUM(valor_total)::NUMERIC             AS faturamento,
    SUM(quantidade)::NUMERIC              AS pecas,
    COUNT(DISTINCT pedido_id)::BIGINT     AS pedidos,
    array_agg(DISTINCT sku ORDER BY sku)  AS variacoes
  FROM itens
  GROUP BY sku_pai
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) TO anon, authenticated;
