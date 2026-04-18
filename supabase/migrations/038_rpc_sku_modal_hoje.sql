-- ============================================================
-- 038_rpc_sku_modal_hoje.sql
--
-- Variantes das RPCs do modal para o filtro "Hoje".
-- Comparam hoje até hora X vs ontem até hora X, usando
-- dashboard_sku_hourly_stats. Mesmo padrão do
-- rpc_alertas_calcular_hoje (migration 032).
--
-- v_hora = EXTRACT(HOUR) no fuso America/Sao_Paulo.
-- Filtro: hora < v_hora (pega só horas fechadas).
-- ============================================================

-- 1. KPIs hora-a-hora
DROP FUNCTION IF EXISTS rpc_sku_modal_kpis_hoje(TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_modal_kpis_hoje(
  p_sku_pai TEXT,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_vendas               NUMERIC,
  out_vendas_anterior      NUMERIC,
  out_faturamento          NUMERIC,
  out_faturamento_anterior NUMERIC,
  out_ticket_medio         NUMERIC,
  out_hora_corte           INT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_hora  INT;
  v_hoje  DATE;
  v_ontem DATE;
BEGIN
  v_hora  := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_hoje  := (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_ontem := v_hoje - 1;

  RETURN QUERY
  WITH atual AS (
    SELECT
      COALESCE(SUM(quantidade), 0)  AS vendas,
      COALESCE(SUM(faturamento), 0) AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE sku_pai = p_sku_pai
      AND data_pedido = v_hoje
      AND hora < v_hora
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
  ),
  anterior AS (
    SELECT
      COALESCE(SUM(quantidade), 0)  AS vendas,
      COALESCE(SUM(faturamento), 0) AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE sku_pai = p_sku_pai
      AND data_pedido = v_ontem
      AND hora < v_hora
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
  )
  SELECT
    a.vendas,
    ant.vendas,
    a.faturamento,
    ant.faturamento,
    CASE
      WHEN a.vendas = 0 THEN 0
      ELSE ROUND(a.faturamento / a.vendas, 2)
    END,
    v_hora
  FROM atual a, anterior ant;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_kpis_hoje(TEXT, TEXT[]) TO anon, authenticated;

-- 2. Série horária (24 pontos, 1 por hora — só horas fechadas)
DROP FUNCTION IF EXISTS rpc_sku_modal_serie_hoje(TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_modal_serie_hoje(
  p_sku_pai TEXT,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_hora        INT,
  out_quantidade  NUMERIC,
  out_faturamento NUMERIC,
  out_pedidos     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_hora INT;
  v_hoje DATE;
BEGIN
  v_hora := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_hoje := (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;

  RETURN QUERY
  SELECT
    s.hora                                    AS out_hora,
    COALESCE(SUM(s.quantidade), 0)            AS out_quantidade,
    COALESCE(SUM(s.faturamento), 0)           AS out_faturamento,
    COALESCE(SUM(s.pedidos_count), 0)::BIGINT AS out_pedidos
  FROM dashboard_sku_hourly_stats s
  WHERE s.sku_pai = p_sku_pai
    AND s.data_pedido = v_hoje
    AND s.hora < v_hora
    AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  GROUP BY s.hora
  ORDER BY s.hora ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_serie_hoje(TEXT, TEXT[]) TO anon, authenticated;

-- 3. Breakdown por loja hora-a-hora
DROP FUNCTION IF EXISTS rpc_sku_modal_por_loja_hoje(TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_modal_por_loja_hoje(
  p_sku_pai TEXT,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_loja             TEXT,
  out_quantidade       NUMERIC,
  out_faturamento      NUMERIC,
  out_variacao_percent NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_hora  INT;
  v_hoje  DATE;
  v_ontem DATE;
BEGIN
  v_hora  := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_hoje  := (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_ontem := v_hoje - 1;

  RETURN QUERY
  WITH atual AS (
    SELECT
      ecommerce_nome                   AS loja,
      COALESCE(SUM(quantidade), 0)     AS quantidade,
      COALESCE(SUM(faturamento), 0)    AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE sku_pai = p_sku_pai
      AND data_pedido = v_hoje
      AND hora < v_hora
    GROUP BY ecommerce_nome
  ),
  anterior AS (
    SELECT
      ecommerce_nome                AS loja,
      COALESCE(SUM(faturamento), 0) AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE sku_pai = p_sku_pai
      AND data_pedido = v_ontem
      AND hora < v_hora
    GROUP BY ecommerce_nome
  )
  SELECT
    a.loja,
    a.quantidade,
    a.faturamento,
    CASE
      WHEN COALESCE(ant.faturamento, 0) = 0 THEN NULL
      ELSE ROUND(((a.faturamento - ant.faturamento) / ant.faturamento) * 100, 1)
    END
  FROM atual a
  LEFT JOIN anterior ant ON ant.loja = a.loja
  ORDER BY a.faturamento DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_por_loja_hoje(TEXT, TEXT[]) TO anon, authenticated;
