-- ============================================================
-- 022_rpc_sku_detalhes.sql
--
-- Move o modal "ver tamanhos" do TopSkus para uma RPC segura.
-- Antes: top-skus.tsx chamava getSkuDetalhes() em vendas-queries.ts
-- que usava fetchAllPedidos via anon — sujeito a:
--   - statement_timeout=3s do role anon (causa 500 em períodos longos)
--   - exposição de PII via RLS aberto
--
-- Agora: rpc_sku_detalhes roda no Postgres via API route com service_role.
-- ============================================================

DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);

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
  )
  SELECT
    pi.sku,
    MAX(pi.descricao)::TEXT       AS descricao,
    SUM(pi.quantidade)::NUMERIC   AS quantidade,
    SUM(pi.valor_total)::NUMERIC  AS faturamento
  FROM pedido_itens pi
  WHERE pi.pedido_id IN (SELECT id FROM aprovados)
    AND COALESCE(substring(pi.sku FROM '^[0-9]+'), pi.sku) = p_sku_pai
  GROUP BY pi.sku
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- DOWN: DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);
