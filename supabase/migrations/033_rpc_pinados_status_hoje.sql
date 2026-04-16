-- ============================================================
-- 033_rpc_pinados_status_hoje.sql
--
-- RPC dedicada para status dos pinados no filtro "Hoje".
-- Compara hoje até hora X vs ontem até hora X (mesma lógica da
-- rpc_alertas_calcular_hoje), mas retorna TODOS os pinados —
-- incluindo estáveis (variação < 5%).
-- ============================================================

DROP FUNCTION IF EXISTS rpc_alertas_pinados_status_hoje(TEXT[]);

CREATE OR REPLACE FUNCTION rpc_alertas_pinados_status_hoje(
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_sku_pai           TEXT,
  out_tipo              TEXT,
  out_severidade        TEXT,
  out_variacao_pct      NUMERIC,
  out_delta_pecas       NUMERIC,
  out_delta_faturamento NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_hora_atual INT;
  v_hoje       DATE;
  v_ontem      DATE;
BEGIN
  v_hora_atual := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_hoje := (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_ontem := v_hoje - 1;

  IF v_hora_atual < 1 THEN
    -- Retorna pinados sem dados (muito cedo)
    RETURN QUERY
    SELECT sp.sku_pai, 'ESTAVEL'::TEXT, 'LEVE'::TEXT,
           0::NUMERIC, 0::NUMERIC, 0::NUMERIC
    FROM sku_pin sp;
    RETURN;
  END IF;

  RETURN QUERY
  WITH pinados AS (SELECT sp.sku_pai FROM sku_pin sp),
  dados_a AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS fat
    FROM dashboard_sku_hourly_stats s
    WHERE s.data_pedido = v_hoje AND s.hora < v_hora_atual
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
      AND s.sku_pai IN (SELECT pin.sku_pai FROM pinados pin)
    GROUP BY s.sku_pai
  ),
  dados_b AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS fat
    FROM dashboard_sku_hourly_stats s
    WHERE s.data_pedido = v_ontem AND s.hora < v_hora_atual
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
      AND s.sku_pai IN (SELECT pin.sku_pai FROM pinados pin)
    GROUP BY s.sku_pai
  )
  SELECT
    p.sku_pai,
    CASE WHEN COALESCE(a.pecas, 0) > COALESCE(b.pecas, 0) THEN 'PICO'
         WHEN COALESCE(a.pecas, 0) < COALESCE(b.pecas, 0) THEN 'QUEDA'
         ELSE 'ESTAVEL'
    END,
    CASE WHEN COALESCE(b.pecas, 0) = 0 THEN 'LEVE'
         WHEN ABS((COALESCE(a.pecas, 0) - COALESCE(b.pecas, 0)) / NULLIF(b.pecas, 0) * 100) >= 30 THEN 'ALTA'
         WHEN ABS((COALESCE(a.pecas, 0) - COALESCE(b.pecas, 0)) / NULLIF(b.pecas, 0) * 100) >= 15 THEN 'MODERADA'
         ELSE 'LEVE'
    END,
    CASE WHEN COALESCE(b.pecas, 0) > 0
         THEN ROUND(((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100)::NUMERIC, 1)
         ELSE 0
    END,
    COALESCE(a.pecas, 0) - COALESCE(b.pecas, 0),
    COALESCE(a.fat, 0) - COALESCE(b.fat, 0)
  FROM pinados p
  LEFT JOIN dados_a a ON a.sku_pai = p.sku_pai
  LEFT JOIN dados_b b ON b.sku_pai = p.sku_pai
  ORDER BY ABS(COALESCE(a.pecas, 0) - COALESCE(b.pecas, 0)) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alertas_pinados_status_hoje(TEXT[]) TO anon, authenticated;
