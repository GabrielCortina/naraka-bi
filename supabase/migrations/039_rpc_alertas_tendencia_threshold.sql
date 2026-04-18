-- ============================================================
-- 039_rpc_alertas_tendencia_threshold.sql
--
-- Ajusta rpc_alertas_tendencia para retornar streaks de >= 2
-- dias (era 3). 2 dias já caracteriza tendência visível no
-- modal e alinha com a expectativa do usuário.
-- Toda a lógica acima é idêntica à migration 034.
-- ============================================================

DROP FUNCTION IF EXISTS rpc_alertas_tendencia(TEXT[]);

CREATE OR REPLACE FUNCTION rpc_alertas_tendencia(
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_sku_pai             TEXT,
  out_dias_consecutivos   INT,
  out_variacao_acumulada  NUMERIC,
  out_direcao             TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_data_inicio DATE := CURRENT_DATE - 14;
BEGIN
  RETURN QUERY
  WITH
  por_dia AS (
    SELECT s.sku_pai,
           s.data_pedido,
           SUM(s.quantidade)::NUMERIC AS pecas
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido >= v_data_inicio
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai, s.data_pedido
  ),
  com_lag AS (
    SELECT sku_pai,
           data_pedido,
           pecas,
           LAG(pecas) OVER (PARTITION BY sku_pai ORDER BY data_pedido) AS pecas_anterior,
           ROW_NUMBER() OVER (PARTITION BY sku_pai ORDER BY data_pedido DESC) AS rn_desc
    FROM por_dia
  ),
  com_direcao AS (
    SELECT sku_pai,
           data_pedido,
           pecas,
           pecas_anterior,
           rn_desc,
           CASE
             WHEN pecas_anterior IS NULL THEN 0
             WHEN pecas > pecas_anterior THEN 1
             WHEN pecas < pecas_anterior THEN -1
             ELSE 0
           END AS direcao
    FROM com_lag
  ),
  direcao_atual AS (
    SELECT sku_pai, direcao AS dir_atual
    FROM com_direcao
    WHERE rn_desc = 1
  ),
  consecutivos AS (
    SELECT cd.sku_pai,
           COUNT(*) AS dias
    FROM com_direcao cd
    JOIN direcao_atual da ON da.sku_pai = cd.sku_pai
    WHERE cd.rn_desc <= 14
      AND cd.pecas_anterior IS NOT NULL
      AND cd.direcao = da.dir_atual
      AND da.dir_atual != 0
      AND NOT EXISTS (
        SELECT 1 FROM com_direcao cd2
        WHERE cd2.sku_pai = cd.sku_pai
          AND cd2.rn_desc < cd.rn_desc
          AND cd2.rn_desc >= 1
          AND cd2.pecas_anterior IS NOT NULL
          AND cd2.direcao != da.dir_atual
      )
    GROUP BY cd.sku_pai
  ),
  com_variacao AS (
    SELECT c.sku_pai,
           c.dias::INT,
           da.dir_atual,
           CASE WHEN primeiro.pecas > 0
                THEN ROUND(((ultimo.pecas - primeiro.pecas) / primeiro.pecas * 100)::NUMERIC, 1)
                ELSE 0
           END AS variacao_acum
    FROM consecutivos c
    JOIN direcao_atual da ON da.sku_pai = c.sku_pai
    JOIN LATERAL (
      SELECT pecas_anterior AS pecas FROM com_direcao
      WHERE sku_pai = c.sku_pai AND rn_desc = c.dias
      LIMIT 1
    ) primeiro ON true
    JOIN LATERAL (
      SELECT pecas FROM com_direcao
      WHERE sku_pai = c.sku_pai AND rn_desc = 1
      LIMIT 1
    ) ultimo ON true
    WHERE c.dias >= 2   -- era >= 3
  )
  SELECT
    cv.sku_pai,
    CASE WHEN cv.dir_atual = -1 THEN -cv.dias ELSE cv.dias END,
    cv.variacao_acum,
    CASE WHEN cv.dir_atual = 1 THEN 'alta'
         WHEN cv.dir_atual = -1 THEN 'queda'
         ELSE 'estavel'
    END
  FROM com_variacao cv
  ORDER BY cv.dias DESC, ABS(cv.variacao_acum) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alertas_tendencia(TEXT[]) TO anon, authenticated;
