-- ============================================================
-- 023_rpc_consolidacao.sql
--
-- Fase 2 da otimização do dashboard:
--   S1 — rpc_kpis_hero_v2: atual + anterior em 1 chamada
--   S2 — rpc_vendas_por_dia_v2: dois períodos em 1 chamada
--   S3 — rpc_comparativo_periodos_v2: SQL puro (não PL/pgSQL)
--   S11 — Índice composto (situacao, data_pedido, ecommerce_nome)
--   S12 — PARALLEL SAFE nas RPCs SQL puras existentes
--
-- IMPORTANTE: as RPCs antigas (020/021/022) permanecem intactas como
-- fallback. O frontend pode ser revertido para chamá-las se necessário.
-- ============================================================

-- ============================================================
-- S11 — Índice composto
-- Cobre filtros típicos: situacao IN (...) AND data BETWEEN AND ecommerce_nome IN (...)
-- Não dropamos os antigos (idx_pedidos_situacao_data, idx_pedidos_data_loja)
-- para evitar regressão em RPCs/queries que dependem deles.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_pedidos_sit_data_loja
  ON pedidos(situacao, data_pedido, ecommerce_nome);

-- ============================================================
-- S12 — PARALLEL SAFE nas RPCs SQL puras existentes
-- (rpc_comparativo_periodos é PL/pgSQL — não recebe; será
--  substituída pela v2 abaixo, que é SQL pura).
-- ============================================================
ALTER FUNCTION rpc_kpis_hero(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_kpis_hero_anterior(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_vendas_por_dia(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_ranking_lojas(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_marketplace(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_heatmap(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_kpis_secundarios(DATE, DATE, TEXT[]) PARALLEL SAFE;
ALTER FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) PARALLEL SAFE;

-- ============================================================
-- S1 — rpc_kpis_hero_v2
-- Retorna 2 linhas: periodo='atual' e periodo='anterior'.
-- Calcula o período anterior automaticamente a partir do atual:
--   duracao = p_end - p_start + 1
--   anterior = [p_start - duracao .. p_start - 1]
-- ============================================================
DROP FUNCTION IF EXISTS rpc_kpis_hero_v2(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_kpis_hero_v2(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  periodo           TEXT,
  faturamento       NUMERIC,
  pedidos           BIGINT,
  pecas             NUMERIC,
  ticket            NUMERIC,
  cancelamentos     BIGINT,
  valor_cancelado   NUMERIC,
  melhor_dia        DATE,
  melhor_dia_valor  NUMERIC,
  media_diaria      NUMERIC,
  dias_com_venda    INT
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH params AS (
    SELECT
      p_start AS s_at,
      p_end   AS e_at,
      (p_start - (p_end - p_start + 1))::DATE AS s_ant,
      (p_start - 1)::DATE                     AS e_ant
  ),
  base AS (
    SELECT
      p.id,
      p.data_pedido,
      p.valor_total_pedido,
      p.situacao,
      CASE
        WHEN p.data_pedido BETWEEN (SELECT s_at FROM params) AND (SELECT e_at FROM params) THEN 'atual'
        ELSE 'anterior'
      END AS periodo
    FROM pedidos p, params
    WHERE p.data_pedido BETWEEN params.s_ant AND params.e_at
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
      AND p.situacao = ANY(ARRAY[1,2,3,4,5,6,7,9]::SMALLINT[])
  ),
  pecas_agg AS (
    SELECT b.periodo, COALESCE(SUM(pi.quantidade), 0)::NUMERIC AS pecas
    FROM base b
    JOIN pedido_itens pi ON pi.pedido_id = b.id
    WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    GROUP BY b.periodo
  ),
  por_dia AS (
    SELECT periodo, data_pedido, SUM(valor_total_pedido) AS fat
    FROM base
    WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    GROUP BY periodo, data_pedido
  ),
  melhor AS (
    SELECT DISTINCT ON (periodo) periodo, data_pedido, fat
    FROM por_dia
    ORDER BY periodo, fat DESC
  ),
  totais AS (
    SELECT
      periodo,
      COALESCE(SUM(valor_total_pedido) FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC AS fat,
      COUNT(*) FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))::BIGINT                              AS pedidos,
      COUNT(*) FILTER (WHERE situacao = 2)::BIGINT                                                                  AS cancelamentos,
      COALESCE(SUM(valor_total_pedido) FILTER (WHERE situacao = 2), 0)::NUMERIC                                     AS valor_cancelado
    FROM base
    GROUP BY periodo
  ),
  periodos AS (
    SELECT 'atual'::TEXT     AS periodo, (SELECT s_at  FROM params) AS s, (SELECT e_at  FROM params) AS e
    UNION ALL
    SELECT 'anterior'::TEXT,             (SELECT s_ant FROM params),     (SELECT e_ant FROM params)
  )
  SELECT
    p.periodo,
    COALESCE(t.fat, 0)::NUMERIC                                                                  AS faturamento,
    COALESCE(t.pedidos, 0)::BIGINT                                                               AS pedidos,
    COALESCE(pa.pecas, 0)::NUMERIC                                                               AS pecas,
    CASE WHEN COALESCE(t.pedidos, 0) > 0 THEN t.fat / t.pedidos ELSE 0 END                       AS ticket,
    COALESCE(t.cancelamentos, 0)::BIGINT                                                         AS cancelamentos,
    COALESCE(t.valor_cancelado, 0)::NUMERIC                                                      AS valor_cancelado,
    m.data_pedido                                                                                AS melhor_dia,
    COALESCE(m.fat, 0)::NUMERIC                                                                  AS melhor_dia_valor,
    CASE WHEN (p.e - p.s + 1) > 0 THEN COALESCE(t.fat, 0) / (p.e - p.s + 1) ELSE 0 END           AS media_diaria,
    (SELECT COUNT(*)::INT FROM por_dia pd WHERE pd.periodo = p.periodo)                          AS dias_com_venda
  FROM periodos p
  LEFT JOIN totais    t  ON t.periodo  = p.periodo
  LEFT JOIN pecas_agg pa ON pa.periodo = p.periodo
  LEFT JOIN melhor    m  ON m.periodo  = p.periodo
  ORDER BY p.periodo DESC  -- 'atual' antes de 'anterior'
$$;

GRANT EXECUTE ON FUNCTION rpc_kpis_hero_v2(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- S2 — rpc_vendas_por_dia_v2
-- Aceita os 4 endpoints de data e retorna linhas tagueadas com periodo.
-- Substitui as 2 chamadas atuais a rpc_vendas_por_dia.
-- ============================================================
DROP FUNCTION IF EXISTS rpc_vendas_por_dia_v2(DATE, DATE, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_vendas_por_dia_v2(
  p_start     DATE,
  p_end       DATE,
  p_start_ant DATE,
  p_end_ant   DATE,
  p_lojas     TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  periodo        TEXT,
  data_pedido    DATE,
  faturamento    NUMERIC,
  pedidos        BIGINT,
  cancelamentos  BIGINT,
  fat_cancelado  NUMERIC,
  pecas          NUMERIC,
  ticket_medio   NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH base AS (
    SELECT
      p.id,
      p.data_pedido,
      p.valor_total_pedido,
      p.situacao,
      CASE
        WHEN p.data_pedido BETWEEN p_start     AND p_end     THEN 'atual'
        WHEN p.data_pedido BETWEEN p_start_ant AND p_end_ant THEN 'anterior'
      END AS periodo
    FROM pedidos p
    WHERE (
        p.data_pedido BETWEEN p_start     AND p_end
     OR p.data_pedido BETWEEN p_start_ant AND p_end_ant
    )
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
      AND p.situacao = ANY(ARRAY[1,2,3,4,5,6,7,9]::SMALLINT[])
  ),
  pecas_por_pedido AS (
    SELECT pi.pedido_id, SUM(pi.quantidade) AS q
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM base)
    GROUP BY pi.pedido_id
  )
  SELECT
    b.periodo,
    b.data_pedido,
    COALESCE(SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    COUNT(*)            FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))::BIGINT,
    COUNT(*)            FILTER (WHERE b.situacao = 2)::BIGINT,
    COALESCE(SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = 2), 0)::NUMERIC,
    COALESCE(SUM(pp.q)  FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    CASE
      WHEN COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])) > 0
      THEN (SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])))::NUMERIC
           / COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))
      ELSE 0
    END
  FROM base b
  LEFT JOIN pecas_por_pedido pp ON pp.pedido_id = b.id
  WHERE b.periodo IS NOT NULL
  GROUP BY b.periodo, b.data_pedido
  ORDER BY b.periodo DESC, b.data_pedido
$$;

GRANT EXECUTE ON FUNCTION rpc_vendas_por_dia_v2(DATE, DATE, DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- S3 — rpc_comparativo_periodos_v2
-- SQL puro (não PL/pgSQL). 1 scan sobre pedidos com FILTER por
-- período, em vez de 6 SELECTs sequenciais.
-- ============================================================
DROP FUNCTION IF EXISTS rpc_comparativo_periodos_v2(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_comparativo_periodos_v2(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  nome             TEXT,
  date_range       TEXT,
  valor            NUMERIC,
  valor_comparado  NUMERIC,
  variacao         NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH datas AS (
    SELECT
      CURRENT_DATE                                AS hoje,
      EXTRACT(DOW FROM CURRENT_DATE)::INT         AS dow,
      EXTRACT(DAY FROM CURRENT_DATE)::INT         AS dia,
      date_trunc('month', CURRENT_DATE)::DATE     AS mes_ini
  ),
  ranges AS (
    SELECT
      d.hoje,
      d.mes_ini,
      d.dia,
      (d.hoje - (CASE WHEN d.dow = 0 THEN 6 ELSE d.dow - 1 END)::INT)            AS sem_ini,
      (d.hoje - (CASE WHEN d.dow = 0 THEN 6 ELSE d.dow - 1 END)::INT - 7)        AS sem_ant_ini,
      (d.hoje - 7)                                                                AS sem_ant_fim,
      (d.mes_ini - INTERVAL '1 month')::DATE                                      AS mes_ant_ini,
      ((d.mes_ini - INTERVAL '1 month')::DATE + (d.dia - 1))                      AS mes_ant_fim,
      (CASE WHEN d.dia <= 15 THEN d.mes_ini ELSE d.mes_ini + 15 END)              AS quinz_ini,
      (CASE WHEN d.dia <= 15
            THEN (d.mes_ini - INTERVAL '1 month')::DATE + 15
            ELSE d.mes_ini END)                                                   AS quinz_ant_ini,
      (CASE WHEN d.dia <= 15
            THEN (d.mes_ini - INTERVAL '1 month')::DATE + 15 + (d.dia - 1)
            ELSE d.mes_ini + (d.dia - 16) END)                                    AS quinz_ant_fim
    FROM datas d
  ),
  agg AS (
    SELECT
      r.*,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.sem_ini       AND r.hoje),         0)::NUMERIC AS sem_at,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.sem_ant_ini   AND r.sem_ant_fim),  0)::NUMERIC AS sem_ant,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.mes_ini       AND r.hoje),         0)::NUMERIC AS mes_at,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.mes_ant_ini   AND r.mes_ant_fim),  0)::NUMERIC AS mes_ant,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.quinz_ini     AND r.hoje),         0)::NUMERIC AS quinz_at,
      COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.data_pedido BETWEEN r.quinz_ant_ini AND r.quinz_ant_fim),0)::NUMERIC AS quinz_ant
    FROM ranges r
    LEFT JOIN pedidos p ON
        p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
        AND p.data_pedido BETWEEN LEAST(r.sem_ant_ini, r.mes_ant_ini, r.quinz_ant_ini) AND r.hoje
        AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
    GROUP BY r.hoje, r.mes_ini, r.dia, r.sem_ini, r.sem_ant_ini, r.sem_ant_fim,
             r.mes_ant_ini, r.mes_ant_fim, r.quinz_ini, r.quinz_ant_ini, r.quinz_ant_fim
  )
  SELECT * FROM (
    SELECT
      'Semana atual'::TEXT,
      (to_char(a.sem_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.sem_at,
      a.sem_ant,
      (CASE
        WHEN a.sem_ant > 0 THEN (a.sem_at - a.sem_ant) / a.sem_ant * 100
        WHEN a.sem_at  > 0 THEN 100::NUMERIC
        ELSE 0::NUMERIC
      END)
    FROM agg a
    UNION ALL
    SELECT
      'Mês atual'::TEXT,
      (to_char(a.mes_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.mes_at,
      a.mes_ant,
      (CASE
        WHEN a.mes_ant > 0 THEN (a.mes_at - a.mes_ant) / a.mes_ant * 100
        WHEN a.mes_at  > 0 THEN 100::NUMERIC
        ELSE 0::NUMERIC
      END)
    FROM agg a
    UNION ALL
    SELECT
      'Quinzena atual'::TEXT,
      (to_char(a.quinz_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.quinz_at,
      a.quinz_ant,
      (CASE
        WHEN a.quinz_ant > 0 THEN (a.quinz_at - a.quinz_ant) / a.quinz_ant * 100
        WHEN a.quinz_at  > 0 THEN 100::NUMERIC
        ELSE 0::NUMERIC
      END)
    FROM agg a
  ) t(nome, date_range, valor, valor_comparado, variacao)
$$;

GRANT EXECUTE ON FUNCTION rpc_comparativo_periodos_v2(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- DOWN (rollback):
-- DROP FUNCTION IF EXISTS rpc_kpis_hero_v2(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_vendas_por_dia_v2(DATE, DATE, DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_comparativo_periodos_v2(DATE, DATE, TEXT[]);
-- DROP INDEX IF EXISTS idx_pedidos_sit_data_loja;
-- ALTER FUNCTION ... PARALLEL UNSAFE; (cada uma)
-- ============================================================
