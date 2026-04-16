-- ============================================================
-- 032_alertas_hourly_stats.sql
--
-- Summary horário para filtro "Hoje" da aba Alertas.
-- Permite comparação hora-a-hora: hoje até Xh vs ontem até Xh.
--
-- Grão: (data_pedido, hora, ecommerce_nome, sku).
-- hora = EXTRACT(HOUR FROM created_at AT TIME ZONE 'America/Sao_Paulo').
-- Pipeline idêntico à 028/030 (kits + alias por prefixo).
-- Triggers statement-level com transition tables (padrão do projeto).
-- ============================================================

-- 1. Tabela
CREATE TABLE IF NOT EXISTS dashboard_sku_hourly_stats (
  data_pedido    DATE    NOT NULL,
  hora           INT     NOT NULL CHECK (hora >= 0 AND hora <= 23),
  ecommerce_nome TEXT    NOT NULL,
  sku            TEXT    NOT NULL,
  sku_pai        TEXT    NOT NULL,
  quantidade     NUMERIC NOT NULL DEFAULT 0,
  faturamento    NUMERIC NOT NULL DEFAULT 0,
  pedidos_count  BIGINT  NOT NULL DEFAULT 0,
  descricao      TEXT    DEFAULT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_pedido, hora, ecommerce_nome, sku)
);

CREATE INDEX IF NOT EXISTS idx_hourly_stats_data_hora
  ON dashboard_sku_hourly_stats (data_pedido, hora);
CREATE INDEX IF NOT EXISTS idx_hourly_stats_sku_pai
  ON dashboard_sku_hourly_stats (sku_pai, data_pedido);
CREATE INDEX IF NOT EXISTS idx_hourly_stats_loja_data
  ON dashboard_sku_hourly_stats (ecommerce_nome, data_pedido);

GRANT SELECT ON dashboard_sku_hourly_stats TO anon, authenticated;

-- 2. Refresh por (data, hora, loja) — pipeline completo com kits + alias
CREATE OR REPLACE FUNCTION refresh_sku_hourly_stats_for(
  p_data           DATE,
  p_hora           INT,
  p_ecommerce_nome TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM dashboard_sku_hourly_stats
   WHERE data_pedido = p_data
     AND hora = p_hora
     AND ecommerce_nome = p_ecommerce_nome;

  INSERT INTO dashboard_sku_hourly_stats (
    data_pedido, hora, ecommerce_nome, sku, sku_pai,
    quantidade, faturamento, pedidos_count, descricao, updated_at
  )
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.data_pedido    = p_data
      AND p.ecommerce_nome = p_ecommerce_nome
      AND p.situacao IN (1,3,4,5,6,7,9)
      AND EXTRACT(HOUR FROM (p.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT = p_hora
  ),
  itens_brutos AS (
    SELECT pi.pedido_id, pi.sku, pi.descricao,
           pi.quantidade::NUMERIC  AS quantidade,
           pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    JOIN aprovados a ON a.id = pi.pedido_id
  ),
  kit_componentes AS (
    SELECT sk.sku_kit, sk.sku_componente, sk.quantidade,
           COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT ib.pedido_id, kc.sku_componente AS sku_step, ib.descricao,
           (ib.quantidade * kc.quantidade)::NUMERIC     AS quantidade,
           (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT ib.pedido_id, ib.sku, ib.descricao, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    LEFT JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    WHERE kc.sku_kit IS NULL
  ),
  normalizado AS (
    SELECT ke.pedido_id, ke.sku_step AS sku, ke.descricao,
           ke.quantidade, ke.valor_total,
           COALESCE(
             substring(sa.sku_canonico FROM '^[0-9]+'),
             sa.sku_canonico,
             substring(ke.sku_step FROM '^[0-9]+'),
             ke.sku_step
           ) AS sku_pai
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = COALESCE(substring(ke.sku_step FROM '^[0-9]+'), ke.sku_step)
      ORDER BY a.canal NULLS LAST LIMIT 1
    ) sa ON true
  ),
  por_sku_pai AS (
    SELECT sku_pai, COUNT(DISTINCT pedido_id)::BIGINT AS pedidos_count
    FROM normalizado GROUP BY sku_pai
  ),
  por_sku AS (
    SELECT sku_pai, sku,
           SUM(valor_total)::NUMERIC AS faturamento,
           SUM(quantidade)::NUMERIC  AS quantidade,
           MAX(descricao)::TEXT      AS descricao
    FROM normalizado GROUP BY sku_pai, sku
  )
  SELECT p_data, p_hora, p_ecommerce_nome,
         ps.sku, ps.sku_pai, ps.quantidade, ps.faturamento,
         pp.pedidos_count, ps.descricao, now()
  FROM por_sku ps
  JOIN por_sku_pai pp ON pp.sku_pai = ps.sku_pai;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_sku_hourly_stats_for(DATE, INT, TEXT) TO anon, authenticated;

-- 3. Triggers (statement-level com transition tables — padrão do projeto)
CREATE OR REPLACE FUNCTION trigger_refresh_hourly_stats_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM refresh_sku_hourly_stats_for(
    t.data_pedido,
    EXTRACT(HOUR FROM (t.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    t.ecommerce_nome
  )
  FROM (
    SELECT DISTINCT data_pedido, created_at, ecommerce_nome
    FROM new_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_hourly_stats_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM refresh_sku_hourly_stats_for(
    t.data_pedido,
    EXTRACT(HOUR FROM (t.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    t.ecommerce_nome
  )
  FROM (
    SELECT data_pedido, created_at, ecommerce_nome FROM old_rows WHERE ecommerce_nome IS NOT NULL
    UNION
    SELECT data_pedido, created_at, ecommerce_nome FROM new_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_hourly_stats_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM refresh_sku_hourly_stats_for(
    t.data_pedido,
    EXTRACT(HOUR FROM (t.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    t.ecommerce_nome
  )
  FROM (
    SELECT DISTINCT data_pedido, created_at, ecommerce_nome
    FROM old_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_insert ON pedidos;
DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_update ON pedidos;
DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_delete ON pedidos;

CREATE TRIGGER pedidos_hourly_stats_refresh_insert
  AFTER INSERT ON pedidos
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_hourly_stats_insert();

CREATE TRIGGER pedidos_hourly_stats_refresh_update
  AFTER UPDATE ON pedidos
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_hourly_stats_update();

CREATE TRIGGER pedidos_hourly_stats_refresh_delete
  AFTER DELETE ON pedidos
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_hourly_stats_delete();

-- 4. Reconciliação
CREATE OR REPLACE FUNCTION reconcile_sku_hourly_stats(p_days_back INT DEFAULT 7)
RETURNS TABLE(data_pedido DATE, ecommerce_nome TEXT, hora INT, atualizado BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT p.data_pedido, p.ecommerce_nome,
           EXTRACT(HOUR FROM (p.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT AS hora
    FROM pedidos p
    WHERE p.data_pedido >= CURRENT_DATE - p_days_back
      AND p.ecommerce_nome IS NOT NULL
    ORDER BY 1, 2, 3
  LOOP
    PERFORM refresh_sku_hourly_stats_for(r.data_pedido, r.hora, r.ecommerce_nome);
    data_pedido    := r.data_pedido;
    ecommerce_nome := r.ecommerce_nome;
    hora           := r.hora;
    atualizado     := TRUE;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_sku_hourly_stats(INT) TO anon, authenticated;

-- 5. RPC: rpc_alertas_calcular_hoje
-- Compara hoje até hora X vs ontem até hora X.
-- Hora X = hora cheia atual em America/Sao_Paulo.
DROP FUNCTION IF EXISTS rpc_alertas_calcular_hoje(TEXT[], TEXT);

CREATE OR REPLACE FUNCTION rpc_alertas_calcular_hoje(
  p_lojas       TEXT[] DEFAULT NULL,
  p_ordenar_por TEXT   DEFAULT 'score'
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
  out_is_pinado            BOOLEAN,
  out_hora_corte           INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_hora_atual   INT;
  v_hoje         DATE;
  v_ontem        DATE;
  v_corte_minimo NUMERIC;
  v_total_fat_b  NUMERIC;
BEGIN
  v_hora_atual := EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'America/Sao_Paulo'))::INT;
  v_hoje := (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_ontem := v_hoje - 1;

  IF v_hora_atual < 1 THEN RETURN; END IF;

  v_corte_minimo := GREATEST(1, ROUND(15.0 * v_hora_atual / 24.0));

  SELECT COALESCE(SUM(faturamento), 1) INTO v_total_fat_b
  FROM dashboard_sku_hourly_stats
  WHERE data_pedido = v_ontem AND hora < v_hora_atual
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  RETURN QUERY
  WITH
  agg_a AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS faturamento
    FROM dashboard_sku_hourly_stats s
    WHERE s.data_pedido = v_hoje AND s.hora < v_hora_atual
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai
  ),
  agg_b AS (
    SELECT s.sku_pai, SUM(s.quantidade) AS pecas, SUM(s.faturamento) AS faturamento
    FROM dashboard_sku_hourly_stats s
    WHERE s.data_pedido = v_ontem AND s.hora < v_hora_atual
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai
  ),
  loja_a AS (
    SELECT sku_pai, ecommerce_nome, SUM(quantidade) AS pecas, SUM(faturamento) AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE data_pedido = v_hoje AND hora < v_hora_atual
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
    GROUP BY sku_pai, ecommerce_nome
  ),
  loja_b AS (
    SELECT sku_pai, ecommerce_nome, SUM(quantidade) AS pecas, SUM(faturamento) AS faturamento
    FROM dashboard_sku_hourly_stats
    WHERE data_pedido = v_ontem AND hora < v_hora_atual
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
                ELSE NULL END AS delta_pct
    FROM loja_a la
    FULL OUTER JOIN loja_b lb ON la.sku_pai = lb.sku_pai AND la.ecommerce_nome = lb.ecommerce_nome
  ),
  breakdown_agg AS (
    SELECT br.sku_pai,
           array_agg(DISTINCT br.loja) FILTER (WHERE br.delta_pecas != 0) AS lojas_afetadas,
           jsonb_agg(jsonb_build_object(
             'loja', br.loja, 'delta_pct', br.delta_pct,
             'delta_pecas', br.delta_pecas, 'delta_faturamento', br.delta_fat
           ) ORDER BY ABS(br.delta_pecas) DESC) AS breakdown_json
    FROM breakdown_raw br GROUP BY br.sku_pai
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
           ELSE NULL END AS m_variacao_pct,
      CASE WHEN COALESCE(a.pecas, 0) > COALESCE(b.pecas, 0) THEN 'PICO'
           WHEN COALESCE(a.pecas, 0) < COALESCE(b.pecas, 0) THEN 'QUEDA'
           ELSE 'ESTAVEL' END AS m_tipo,
      CASE
        WHEN COALESCE(b.pecas, 0) = 0 THEN 'LEVE'
        WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 30 THEN 'ALTA'
        WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 15 THEN 'MODERADA'
        ELSE 'LEVE' END AS m_severidade,
      bd.lojas_afetadas AS m_lojas_afetadas,
      bd.breakdown_json AS m_breakdown_json,
      ROUND((
        (ABS(COALESCE(a.faturamento, 0) - COALESCE(b.faturamento, 0)) / v_total_fat_b * 1000) +
        (CASE
          WHEN COALESCE(b.pecas, 0) = 0 THEN 5
          WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 30 THEN 30
          WHEN ABS((COALESCE(a.pecas, 0) - b.pecas) / b.pecas * 100) >= 15 THEN 15
          ELSE 5 END) +
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
         m.m_lojas_afetadas, m.m_breakdown_json, m.m_is_pinado,
         v_hora_atual
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

GRANT EXECUTE ON FUNCTION rpc_alertas_calcular_hoje(TEXT[], TEXT) TO anon, authenticated;

-- ============================================================
-- DOWN:
-- DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_insert ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_update ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_hourly_stats_refresh_delete ON pedidos;
-- DROP FUNCTION IF EXISTS trigger_refresh_hourly_stats_insert();
-- DROP FUNCTION IF EXISTS trigger_refresh_hourly_stats_update();
-- DROP FUNCTION IF EXISTS trigger_refresh_hourly_stats_delete();
-- DROP FUNCTION IF EXISTS reconcile_sku_hourly_stats(INT);
-- DROP FUNCTION IF EXISTS refresh_sku_hourly_stats_for(DATE, INT, TEXT);
-- DROP FUNCTION IF EXISTS rpc_alertas_calcular_hoje(TEXT[], TEXT);
-- DROP TABLE IF EXISTS dashboard_sku_hourly_stats;
-- ============================================================
