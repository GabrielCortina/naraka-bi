-- ============================================================
-- 031_alertas_module.sql
--
-- Motor de detecção automática de anomalias por SKU.
-- Compara dois períodos, detecta variações significativas,
-- classifica por severidade, prioriza por impacto financeiro
-- normalizado, e mostra breakdown por loja.
--
-- Lê exclusivamente de dashboard_sku_daily_stats (summary).
-- Sem leitura em pedidos/pedido_itens. Performance <500ms.
--
-- NOTA: colunas de RETURNS TABLE prefixadas com out_ para evitar
-- ambiguidade com colunas de mesmo nome em CTEs internas (PG
-- trata RETURNS TABLE como variáveis plpgsql).
-- ============================================================

-- 1. Tabela de SKUs monitorados (PIN)
CREATE TABLE IF NOT EXISTS sku_pin (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_pai    TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sku_pin_sku_pai ON sku_pin (sku_pai);
GRANT SELECT, INSERT, DELETE ON sku_pin TO anon, authenticated;

-- 2. Cache de análises IA
CREATE TABLE IF NOT EXISTS alertas_analise_ia (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_analise      DATE NOT NULL,
  periodo_preset    TEXT NOT NULL,
  loja_filtro       TEXT[],
  analise_texto     TEXT NOT NULL,
  alertas_contexto  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alertas_ia_data
  ON alertas_analise_ia (data_analise DESC);
GRANT SELECT, INSERT ON alertas_analise_ia TO anon, authenticated;

-- 3. RPC principal: rpc_alertas_calcular
DROP FUNCTION IF EXISTS rpc_alertas_calcular(DATE, DATE, DATE, DATE, TEXT[], TEXT);

CREATE OR REPLACE FUNCTION rpc_alertas_calcular(
  p_periodo_a_inicio DATE,
  p_periodo_a_fim    DATE,
  p_periodo_b_inicio DATE,
  p_periodo_b_fim    DATE,
  p_lojas            TEXT[] DEFAULT NULL,
  p_ordenar_por      TEXT   DEFAULT 'score'
)
RETURNS TABLE (
  out_sku_pai              TEXT,
  out_tipo                 TEXT,
  out_severidade           TEXT,
  out_periodo_a_pecas      NUMERIC,
  out_periodo_b_pecas      NUMERIC,
  out_delta_pecas          NUMERIC,
  out_periodo_a_faturamento NUMERIC,
  out_periodo_b_faturamento NUMERIC,
  out_delta_faturamento    NUMERIC,
  out_variacao_pct         NUMERIC,
  out_score                NUMERIC,
  out_lojas_afetadas       TEXT[],
  out_breakdown_lojas      JSONB,
  out_is_pinado            BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_dias_periodo   INT;
  v_corte_minimo   NUMERIC;
  v_total_fat_b    NUMERIC;
BEGIN
  v_dias_periodo := p_periodo_b_fim - p_periodo_b_inicio + 1;
  v_corte_minimo := 15 * v_dias_periodo;

  SELECT COALESCE(SUM(faturamento), 1)
  INTO v_total_fat_b
  FROM dashboard_sku_daily_stats
  WHERE data_pedido BETWEEN p_periodo_b_inicio AND p_periodo_b_fim
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  RETURN QUERY
  WITH
  agg_a AS (
    SELECT s.sku_pai,
           SUM(s.quantidade)  AS pecas,
           SUM(s.faturamento) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido BETWEEN p_periodo_a_inicio AND p_periodo_a_fim
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai
  ),
  agg_b AS (
    SELECT s.sku_pai,
           SUM(s.quantidade)  AS pecas,
           SUM(s.faturamento) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido BETWEEN p_periodo_b_inicio AND p_periodo_b_fim
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai
  ),
  loja_a AS (
    SELECT sku_pai, ecommerce_nome,
           SUM(quantidade) AS pecas, SUM(faturamento) AS faturamento
    FROM dashboard_sku_daily_stats
    WHERE data_pedido BETWEEN p_periodo_a_inicio AND p_periodo_a_fim
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
    GROUP BY sku_pai, ecommerce_nome
  ),
  loja_b AS (
    SELECT sku_pai, ecommerce_nome,
           SUM(quantidade) AS pecas, SUM(faturamento) AS faturamento
    FROM dashboard_sku_daily_stats
    WHERE data_pedido BETWEEN p_periodo_b_inicio AND p_periodo_b_fim
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
    GROUP BY sku_pai, ecommerce_nome
  ),
  breakdown_raw AS (
    SELECT COALESCE(la.sku_pai, lb.sku_pai) AS sku_pai,
           COALESCE(la.ecommerce_nome, lb.ecommerce_nome) AS loja,
           COALESCE(la.pecas, 0) - COALESCE(lb.pecas, 0) AS delta_pecas,
           COALESCE(la.faturamento, 0) - COALESCE(lb.faturamento, 0) AS delta_fat,
           CASE WHEN COALESCE(lb.pecas, 0) > 0
                THEN ROUND(((COALESCE(la.pecas, 0) - lb.pecas) / lb.pecas * 100)::NUMERIC, 1)
                ELSE NULL
           END AS delta_pct
    FROM loja_a la
    FULL OUTER JOIN loja_b lb
      ON la.sku_pai = lb.sku_pai AND la.ecommerce_nome = lb.ecommerce_nome
  ),
  breakdown_agg AS (
    SELECT br.sku_pai,
           array_agg(DISTINCT br.loja) FILTER (WHERE br.delta_pecas != 0) AS lojas_afetadas,
           jsonb_agg(
             jsonb_build_object(
               'loja', br.loja,
               'delta_pct', br.delta_pct,
               'delta_pecas', br.delta_pecas,
               'delta_faturamento', br.delta_fat
             ) ORDER BY ABS(br.delta_pecas) DESC
           ) AS breakdown_json
    FROM breakdown_raw br
    GROUP BY br.sku_pai
  ),
  metricas AS (
    SELECT
      COALESCE(a.sku_pai, b.sku_pai) AS m_sku_pai,
      COALESCE(a.pecas, 0) AS m_a_pecas,
      COALESCE(b.pecas, 0) AS m_b_pecas,
      COALESCE(a.faturamento, 0) AS m_a_fat,
      COALESCE(b.faturamento, 0) AS m_b_fat,
      COALESCE(a.pecas, 0) - COALESCE(b.pecas, 0) AS m_delta_pecas,
      COALESCE(a.faturamento, 0) - COALESCE(b.faturamento, 0) AS m_delta_fat,
      CASE WHEN COALESCE(b.pecas, 0) > 0
           THEN ROUND(((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100)::NUMERIC, 1)
           ELSE NULL
      END AS m_variacao_pct,
      CASE WHEN COALESCE(a.pecas, 0) > COALESCE(b.pecas, 0) THEN 'PICO'
           WHEN COALESCE(a.pecas, 0) < COALESCE(b.pecas, 0) THEN 'QUEDA'
           ELSE 'ESTAVEL'
      END AS m_tipo,
      CASE
        WHEN COALESCE(b.pecas, 0) = 0 THEN 'LEVE'
        WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 30 THEN 'ALTA'
        WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 15 THEN 'MODERADA'
        ELSE 'LEVE'
      END AS m_severidade,
      bd.lojas_afetadas AS m_lojas_afetadas,
      bd.breakdown_json AS m_breakdown_json,
      ROUND((
        (ABS(COALESCE(a.faturamento, 0) - COALESCE(b.faturamento, 0)) / v_total_fat_b * 1000) +
        (CASE
          WHEN COALESCE(b.pecas, 0) = 0 THEN 5
          WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 30 THEN 30
          WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 15 THEN 15
          ELSE 5
        END) +
        (COALESCE(array_length(bd.lojas_afetadas, 1), 1) - 1) * 10
      )::NUMERIC, 2) AS m_score,
      EXISTS(SELECT 1 FROM sku_pin sp WHERE sp.sku_pai = COALESCE(a.sku_pai, b.sku_pai)) AS m_is_pinado
    FROM agg_a a
    FULL OUTER JOIN agg_b b ON a.sku_pai = b.sku_pai
    LEFT JOIN breakdown_agg bd ON bd.sku_pai = COALESCE(a.sku_pai, b.sku_pai)
    WHERE COALESCE(b.pecas, 0) >= v_corte_minimo
      AND COALESCE(b.pecas, 0) > 0
      AND ABS(CASE WHEN b.pecas > 0
                   THEN ((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100)
                   ELSE 0 END) >= 5
  )
  SELECT m.m_sku_pai, m.m_tipo, m.m_severidade,
         m.m_a_pecas, m.m_b_pecas, m.m_delta_pecas,
         m.m_a_fat, m.m_b_fat, m.m_delta_fat,
         m.m_variacao_pct, m.m_score,
         m.m_lojas_afetadas, m.m_breakdown_json, m.m_is_pinado
  FROM metricas m
  WHERE m.m_tipo != 'ESTAVEL'
  ORDER BY
    m.m_is_pinado DESC,
    CASE p_ordenar_por
      WHEN 'pecas' THEN ABS(m.m_delta_pecas)
      WHEN 'faturamento' THEN ABS(m.m_delta_fat)
      ELSE m.m_score
    END DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alertas_calcular(DATE, DATE, DATE, DATE, TEXT[], TEXT)
  TO anon, authenticated;

-- 4. RPC resumo (contadores por tipo x severidade)
DROP FUNCTION IF EXISTS rpc_alertas_resumo(DATE, DATE, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_alertas_resumo(
  p_periodo_a_inicio DATE,
  p_periodo_a_fim    DATE,
  p_periodo_b_inicio DATE,
  p_periodo_b_fim    DATE,
  p_lojas            TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_tipo        TEXT,
  out_severidade  TEXT,
  out_quantidade  BIGINT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT out_tipo, out_severidade, COUNT(*)::BIGINT AS out_quantidade
  FROM rpc_alertas_calcular(
    p_periodo_a_inicio, p_periodo_a_fim,
    p_periodo_b_inicio, p_periodo_b_fim,
    p_lojas, 'score'
  )
  GROUP BY out_tipo, out_severidade
  ORDER BY out_tipo,
    CASE out_severidade WHEN 'ALTA' THEN 1 WHEN 'MODERADA' THEN 2 ELSE 3 END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alertas_resumo(DATE, DATE, DATE, DATE, TEXT[])
  TO anon, authenticated;

-- 5. RPC status dos pinados
DROP FUNCTION IF EXISTS rpc_alertas_pinados_status(DATE, DATE, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_alertas_pinados_status(
  p_periodo_a_inicio DATE,
  p_periodo_a_fim    DATE,
  p_periodo_b_inicio DATE,
  p_periodo_b_fim    DATE,
  p_lojas            TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_sku_pai           TEXT,
  out_tipo              TEXT,
  out_severidade        TEXT,
  out_variacao_pct      NUMERIC,
  out_delta_pecas       NUMERIC,
  out_delta_faturamento NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH pinados AS (SELECT sp.sku_pai FROM sku_pin sp),
  dados_a AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS fat
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido BETWEEN p_periodo_a_inicio AND p_periodo_a_fim
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
      AND s.sku_pai IN (SELECT pin.sku_pai FROM pinados pin)
    GROUP BY s.sku_pai
  ),
  dados_b AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS fat
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido BETWEEN p_periodo_b_inicio AND p_periodo_b_fim
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
$$;

GRANT EXECUTE ON FUNCTION rpc_alertas_pinados_status(DATE, DATE, DATE, DATE, TEXT[])
  TO anon, authenticated;

-- ============================================================
-- DOWN (rollback):
-- DROP FUNCTION IF EXISTS rpc_alertas_pinados_status(DATE, DATE, DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_alertas_resumo(DATE, DATE, DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_alertas_calcular(DATE, DATE, DATE, DATE, TEXT[], TEXT);
-- DROP TABLE IF EXISTS alertas_analise_ia;
-- DROP TABLE IF EXISTS sku_pin;
-- ============================================================
