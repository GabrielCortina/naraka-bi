-- ============================================================
-- 024_dashboard_daily_stats.sql
--
-- Fase 3: tabela summary diária + trigger + RPCs v3.
--
-- Conceito: pedidos antigos NÃO mudam. Pré-agregar 1× por dia/loja
-- e ler do summary torna qualquer KPI sub-100ms, independente do
-- volume de pedidos. RPCs v3 substituem v1/v2 onde possível.
--
-- Migrations 020-023 permanecem intactas (RPCs servem de fallback
-- caso a tabela summary ainda não esteja populada).
--
-- ATENÇÃO: A SEÇÃO DE BACKFILL NO FINAL ESTÁ COMENTADA. Ela deve
-- ser executada SEPARADAMENTE depois desta migration (pode demorar
-- 1-2 minutos para 56k pedidos). Antes do backfill, as RPCs v3
-- retornam vazio.
-- ============================================================

-- ============================================================
-- 1. TABELA SUMMARY (1 linha por dia × loja)
-- ============================================================
CREATE TABLE IF NOT EXISTS dashboard_daily_stats (
  data_pedido    DATE        NOT NULL,
  ecommerce_nome TEXT        NOT NULL,
  faturamento    NUMERIC     NOT NULL DEFAULT 0,
  pedidos        BIGINT      NOT NULL DEFAULT 0,
  pecas          NUMERIC     NOT NULL DEFAULT 0,
  cancelamentos  BIGINT      NOT NULL DEFAULT 0,
  fat_cancelado  NUMERIC     NOT NULL DEFAULT 0,
  valor_desconto NUMERIC     NOT NULL DEFAULT 0,
  valor_frete    NUMERIC     NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_pedido, ecommerce_nome)
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_data
  ON dashboard_daily_stats(data_pedido);
CREATE INDEX IF NOT EXISTS idx_daily_stats_loja
  ON dashboard_daily_stats(ecommerce_nome, data_pedido);

-- Anon pode ler (RPCs v3 leem desta tabela via SECURITY DEFINER,
-- mas grant explícito facilita debug).
GRANT SELECT ON dashboard_daily_stats TO anon, authenticated;

-- ============================================================
-- 2. FUNÇÃO BASE — recompute uma única (data, loja)
-- Usada pelo trigger e pela reconciliação.
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_daily_stats_for(
  p_data           DATE,
  p_ecommerce_nome TEXT
)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO dashboard_daily_stats (
    data_pedido, ecommerce_nome,
    faturamento, pedidos, pecas,
    cancelamentos, fat_cancelado,
    valor_desconto, valor_frete, updated_at
  )
  SELECT
    p_data,
    p_ecommerce_nome,
    COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
    COUNT(*)                            FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])),
    COALESCE(SUM(pi_sum.pecas)          FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
    COUNT(*)                            FILTER (WHERE p.situacao = 2),
    COALESCE(SUM(p.valor_total_pedido)  FILTER (WHERE p.situacao = 2), 0),
    COALESCE(SUM(p.valor_desconto)      FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
    COALESCE(SUM(p.valor_frete)         FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
    now()
  FROM pedidos p
  LEFT JOIN (
    SELECT pedido_id, SUM(quantidade) AS pecas
    FROM pedido_itens
    GROUP BY pedido_id
  ) pi_sum ON pi_sum.pedido_id = p.id
  WHERE p.data_pedido     = p_data
    AND p.ecommerce_nome  = p_ecommerce_nome
  ON CONFLICT (data_pedido, ecommerce_nome) DO UPDATE SET
    faturamento    = EXCLUDED.faturamento,
    pedidos        = EXCLUDED.pedidos,
    pecas          = EXCLUDED.pecas,
    cancelamentos  = EXCLUDED.cancelamentos,
    fat_cancelado  = EXCLUDED.fat_cancelado,
    valor_desconto = EXCLUDED.valor_desconto,
    valor_frete    = EXCLUDED.valor_frete,
    updated_at     = now();
$$;

GRANT EXECUTE ON FUNCTION refresh_daily_stats_for(DATE, TEXT) TO anon, authenticated;

-- ============================================================
-- 3. TRIGGER FUNCTIONS (statement-level com transition tables)
-- Uma única agg query por (data, loja) DISTINTA do statement —
-- evita a quadráticidade do FOR EACH ROW quando o polling
-- insere 100 pedidos no mesmo dia/loja.
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_refresh_daily_stats_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM new_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_daily_stats_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Refresh em ambos os lados: linha pode ter mudado de dia/loja.
  PERFORM refresh_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT data_pedido, ecommerce_nome FROM old_rows WHERE ecommerce_nome IS NOT NULL
    UNION
    SELECT data_pedido, ecommerce_nome FROM new_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_daily_stats_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM old_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

-- ============================================================
-- 4. TRIGGERS (3 — um por evento, com transition tables apropriadas)
-- ============================================================
DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh         ON pedidos;
DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_insert  ON pedidos;
DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_update  ON pedidos;
DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_delete  ON pedidos;

CREATE TRIGGER pedidos_daily_stats_refresh_insert
  AFTER INSERT ON pedidos
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_daily_stats_insert();

CREATE TRIGGER pedidos_daily_stats_refresh_update
  AFTER UPDATE ON pedidos
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_daily_stats_update();

CREATE TRIGGER pedidos_daily_stats_refresh_delete
  AFTER DELETE ON pedidos
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_daily_stats_delete();

-- ============================================================
-- 5. FUNÇÃO DE RECONCILIAÇÃO
-- Refresca todos os (data, loja) dos últimos N dias.
-- Pode ser chamada pelo cron diário existente ou manualmente
-- se o trigger falhar silenciosamente.
-- ============================================================
CREATE OR REPLACE FUNCTION reconcile_daily_stats(
  p_days_back INT DEFAULT 3
)
RETURNS TABLE(
  data_pedido    DATE,
  ecommerce_nome TEXT,
  atualizado     BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT p.data_pedido, p.ecommerce_nome
    FROM pedidos p
    WHERE p.data_pedido >= CURRENT_DATE - p_days_back
      AND p.ecommerce_nome IS NOT NULL
    ORDER BY p.data_pedido, p.ecommerce_nome
  LOOP
    PERFORM refresh_daily_stats_for(r.data_pedido, r.ecommerce_nome);
    data_pedido    := r.data_pedido;
    ecommerce_nome := r.ecommerce_nome;
    atualizado     := TRUE;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_daily_stats(INT) TO anon, authenticated;

-- ============================================================
-- 6. RPCs v3 — leem do summary
-- Sub-50ms para qualquer período. Substituem hero/secundarios/
-- ranking/marketplace/comparativo/vendas-por-dia onde aplicável.
-- top_skus e heatmap continuam lendo de pedidos/pedido_itens
-- (precisam de dados por SKU/hora).
-- ============================================================

-- 6.1 rpc_kpis_hero_v3
DROP FUNCTION IF EXISTS rpc_kpis_hero_v3(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_kpis_hero_v3(
  p_start DATE, p_end DATE, p_lojas TEXT[] DEFAULT NULL
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
      p_start AS s_at, p_end AS e_at,
      (p_start - (p_end - p_start + 1))::DATE AS s_ant,
      (p_start - 1)::DATE AS e_ant
  ),
  base AS (
    SELECT
      s.data_pedido, s.faturamento, s.pedidos, s.pecas,
      s.cancelamentos, s.fat_cancelado,
      CASE
        WHEN s.data_pedido BETWEEN (SELECT s_at FROM params) AND (SELECT e_at FROM params) THEN 'atual'
        ELSE 'anterior'
      END AS periodo
    FROM dashboard_daily_stats s, params
    WHERE s.data_pedido BETWEEN params.s_ant AND params.e_at
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  ),
  por_dia AS (
    -- Soma múltiplas lojas no mesmo dia → melhor dia agregado.
    SELECT periodo, data_pedido, SUM(faturamento) AS fat
    FROM base
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
      COALESCE(SUM(faturamento), 0)::NUMERIC   AS fat,
      COALESCE(SUM(pedidos), 0)::BIGINT        AS pedidos,
      COALESCE(SUM(pecas), 0)::NUMERIC         AS pecas,
      COALESCE(SUM(cancelamentos), 0)::BIGINT  AS cancelamentos,
      COALESCE(SUM(fat_cancelado), 0)::NUMERIC AS fat_cancelado
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
    COALESCE(t.fat, 0)::NUMERIC,
    COALESCE(t.pedidos, 0)::BIGINT,
    COALESCE(t.pecas, 0)::NUMERIC,
    CASE WHEN COALESCE(t.pedidos, 0) > 0 THEN t.fat / t.pedidos ELSE 0 END,
    COALESCE(t.cancelamentos, 0)::BIGINT,
    COALESCE(t.fat_cancelado, 0)::NUMERIC,
    m.data_pedido,
    COALESCE(m.fat, 0)::NUMERIC,
    CASE WHEN (p.e - p.s + 1) > 0 THEN COALESCE(t.fat, 0) / (p.e - p.s + 1) ELSE 0 END,
    (SELECT COUNT(*)::INT FROM por_dia pd WHERE pd.periodo = p.periodo AND pd.fat > 0)
  FROM periodos p
  LEFT JOIN totais t ON t.periodo = p.periodo
  LEFT JOIN melhor m ON m.periodo = p.periodo
  ORDER BY p.periodo DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_kpis_hero_v3(DATE, DATE, TEXT[]) TO anon, authenticated;

-- 6.2 rpc_vendas_por_dia_v3
DROP FUNCTION IF EXISTS rpc_vendas_por_dia_v3(DATE, DATE, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_vendas_por_dia_v3(
  p_start DATE, p_end DATE,
  p_start_ant DATE, p_end_ant DATE,
  p_lojas TEXT[] DEFAULT NULL
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
      s.data_pedido, s.faturamento, s.pedidos, s.cancelamentos,
      s.fat_cancelado, s.pecas,
      CASE
        WHEN s.data_pedido BETWEEN p_start     AND p_end     THEN 'atual'
        WHEN s.data_pedido BETWEEN p_start_ant AND p_end_ant THEN 'anterior'
      END AS periodo
    FROM dashboard_daily_stats s
    WHERE (s.data_pedido BETWEEN p_start     AND p_end
        OR s.data_pedido BETWEEN p_start_ant AND p_end_ant)
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  )
  SELECT
    periodo, data_pedido,
    SUM(faturamento)::NUMERIC,
    SUM(pedidos)::BIGINT,
    SUM(cancelamentos)::BIGINT,
    SUM(fat_cancelado)::NUMERIC,
    SUM(pecas)::NUMERIC,
    CASE WHEN SUM(pedidos) > 0 THEN SUM(faturamento) / SUM(pedidos) ELSE 0 END
  FROM base
  WHERE periodo IS NOT NULL
  GROUP BY periodo, data_pedido
  ORDER BY periodo DESC, data_pedido
$$;

GRANT EXECUTE ON FUNCTION rpc_vendas_por_dia_v3(DATE, DATE, DATE, DATE, TEXT[]) TO anon, authenticated;

-- 6.3 rpc_kpis_secundarios_v3
DROP FUNCTION IF EXISTS rpc_kpis_secundarios_v3(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_kpis_secundarios_v3(
  p_start DATE, p_end DATE, p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  faturamento_bruto      NUMERIC,
  faturamento_liquido    NUMERIC,
  valor_desconto         NUMERIC,
  valor_frete            NUMERIC,
  percentual_desconto    NUMERIC,
  percentual_frete       NUMERIC,
  taxa_cancelamento      NUMERIC,
  faturamento_cancelado  NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH agg AS (
    SELECT
      COALESCE(SUM(faturamento),    0)::NUMERIC AS fat_bruto,
      COALESCE(SUM(valor_desconto), 0)::NUMERIC AS desconto,
      COALESCE(SUM(valor_frete),    0)::NUMERIC AS frete,
      COALESCE(SUM(pedidos),        0)::NUMERIC AS n_aprov,
      COALESCE(SUM(cancelamentos),  0)::NUMERIC AS n_canc,
      COALESCE(SUM(fat_cancelado),  0)::NUMERIC AS fat_canc
    FROM dashboard_daily_stats
    WHERE data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas))
  )
  SELECT
    a.fat_bruto,
    (a.fat_bruto - a.desconto - a.frete)::NUMERIC,
    a.desconto,
    a.frete,
    CASE WHEN a.fat_bruto > 0 THEN (a.desconto / a.fat_bruto * 100) ELSE 0 END,
    CASE WHEN a.fat_bruto > 0 THEN (a.frete    / a.fat_bruto * 100) ELSE 0 END,
    CASE WHEN (a.n_aprov + a.n_canc) > 0
         THEN (a.n_canc / (a.n_aprov + a.n_canc) * 100)
         ELSE 0
    END,
    a.fat_canc
  FROM agg a
$$;

GRANT EXECUTE ON FUNCTION rpc_kpis_secundarios_v3(DATE, DATE, TEXT[]) TO anon, authenticated;

-- 6.4 rpc_ranking_lojas_v3
DROP FUNCTION IF EXISTS rpc_ranking_lojas_v3(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_ranking_lojas_v3(
  p_start DATE, p_end DATE, p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  ecommerce_nome     TEXT,
  nome_loja          TEXT,
  marketplace        TEXT,
  faturamento        NUMERIC,
  pedidos            BIGINT,
  pecas              NUMERIC,
  ticket             NUMERIC,
  cancelamentos      BIGINT,
  taxa_cancelamento  NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH base AS (
    SELECT
      s.ecommerce_nome,
      SUM(s.faturamento)::NUMERIC   AS fat,
      SUM(s.pedidos)::BIGINT        AS ped,
      SUM(s.pecas)::NUMERIC         AS pec,
      SUM(s.cancelamentos)::BIGINT  AS canc
    FROM dashboard_daily_stats s
    WHERE s.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.ecommerce_nome
  )
  SELECT
    COALESCE(b.ecommerce_nome, 'Sem loja'),
    COALESCE(lc.nome_loja, lc.nome_exibicao, b.ecommerce_nome, 'Sem loja'),
    COALESCE(lc.marketplace, ''),
    b.fat,
    b.ped,
    b.pec,
    CASE WHEN b.ped > 0 THEN b.fat / b.ped ELSE 0 END,
    b.canc,
    CASE WHEN (b.ped + b.canc) > 0
         THEN b.canc::NUMERIC / (b.ped + b.canc) * 100
         ELSE 0
    END
  FROM base b
  LEFT JOIN loja_config lc ON lc.ecommerce_nome_tiny = b.ecommerce_nome
  ORDER BY b.fat DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_ranking_lojas_v3(DATE, DATE, TEXT[]) TO anon, authenticated;

-- 6.5 rpc_marketplace_v3
DROP FUNCTION IF EXISTS rpc_marketplace_v3(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_marketplace_v3(
  p_start DATE, p_end DATE, p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  marketplace  TEXT,
  faturamento  NUMERIC,
  pedidos      BIGINT,
  percentual   NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH base AS (
    SELECT
      COALESCE(lc.marketplace, 'outro') AS mp,
      s.faturamento,
      s.pedidos
    FROM dashboard_daily_stats s
    LEFT JOIN loja_config lc ON lc.ecommerce_nome_tiny = s.ecommerce_nome
    WHERE s.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  ),
  total AS (
    SELECT COALESCE(SUM(faturamento), 0)::NUMERIC AS t FROM base
  )
  SELECT
    b.mp::TEXT,
    SUM(b.faturamento)::NUMERIC,
    SUM(b.pedidos)::BIGINT,
    CASE
      WHEN (SELECT t FROM total) > 0
      THEN (SUM(b.faturamento) / (SELECT t FROM total) * 100)::NUMERIC
      ELSE 0
    END
  FROM base b
  GROUP BY b.mp
  ORDER BY 2 DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_marketplace_v3(DATE, DATE, TEXT[]) TO anon, authenticated;

-- 6.6 rpc_comparativo_periodos_v3
DROP FUNCTION IF EXISTS rpc_comparativo_periodos_v3(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_comparativo_periodos_v3(
  p_start DATE, p_end DATE, p_lojas TEXT[] DEFAULT NULL
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
      CURRENT_DATE                            AS hoje,
      EXTRACT(DOW FROM CURRENT_DATE)::INT     AS dow,
      EXTRACT(DAY FROM CURRENT_DATE)::INT     AS dia,
      date_trunc('month', CURRENT_DATE)::DATE AS mes_ini
  ),
  ranges AS (
    SELECT
      d.hoje, d.mes_ini, d.dia,
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
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.sem_ini       AND r.hoje),         0)::NUMERIC AS sem_at,
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.sem_ant_ini   AND r.sem_ant_fim),  0)::NUMERIC AS sem_ant,
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.mes_ini       AND r.hoje),         0)::NUMERIC AS mes_at,
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.mes_ant_ini   AND r.mes_ant_fim),  0)::NUMERIC AS mes_ant,
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.quinz_ini     AND r.hoje),         0)::NUMERIC AS quinz_at,
      COALESCE(SUM(s.faturamento) FILTER (WHERE s.data_pedido BETWEEN r.quinz_ant_ini AND r.quinz_ant_fim),0)::NUMERIC AS quinz_ant
    FROM ranges r
    LEFT JOIN dashboard_daily_stats s ON
        s.data_pedido BETWEEN LEAST(r.sem_ant_ini, r.mes_ant_ini, r.quinz_ant_ini) AND r.hoje
        AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY r.hoje, r.mes_ini, r.dia, r.sem_ini, r.sem_ant_ini, r.sem_ant_fim,
             r.mes_ant_ini, r.mes_ant_fim, r.quinz_ini, r.quinz_ant_ini, r.quinz_ant_fim
  )
  SELECT * FROM (
    SELECT
      'Semana atual'::TEXT,
      (to_char(a.sem_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.sem_at, a.sem_ant,
      (CASE WHEN a.sem_ant > 0 THEN (a.sem_at - a.sem_ant) / a.sem_ant * 100
            WHEN a.sem_at  > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END)
    FROM agg a
    UNION ALL
    SELECT
      'Mês atual'::TEXT,
      (to_char(a.mes_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.mes_at, a.mes_ant,
      (CASE WHEN a.mes_ant > 0 THEN (a.mes_at - a.mes_ant) / a.mes_ant * 100
            WHEN a.mes_at  > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END)
    FROM agg a
    UNION ALL
    SELECT
      'Quinzena atual'::TEXT,
      (to_char(a.quinz_ini, 'DD/MM') || ' – ' || to_char(a.hoje, 'DD/MM'))::TEXT,
      a.quinz_at, a.quinz_ant,
      (CASE WHEN a.quinz_ant > 0 THEN (a.quinz_at - a.quinz_ant) / a.quinz_ant * 100
            WHEN a.quinz_at  > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END)
    FROM agg a
  ) t(nome, date_range, valor, valor_comparado, variacao)
$$;

GRANT EXECUTE ON FUNCTION rpc_comparativo_periodos_v3(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- 7. BACKFILL — EXECUTAR SEPARADAMENTE APÓS ESTA MIGRATION
--
-- Pode demorar 1-2 minutos para 56k pedidos.
-- A migration cria a estrutura; o backfill popula o histórico.
-- A partir do backfill, o trigger mantém atualizado em tempo real.
--
-- Copie o bloco abaixo (sem os comentários SQL) para o SQL Editor:
-- ============================================================
-- INSERT INTO dashboard_daily_stats (
--   data_pedido, ecommerce_nome,
--   faturamento, pedidos, pecas,
--   cancelamentos, fat_cancelado,
--   valor_desconto, valor_frete, updated_at
-- )
-- SELECT
--   p.data_pedido,
--   p.ecommerce_nome,
--   COALESCE(SUM(p.valor_total_pedido) FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
--   COUNT(*)                            FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])),
--   COALESCE(SUM(pi_sum.pecas)          FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
--   COUNT(*)                            FILTER (WHERE p.situacao = 2),
--   COALESCE(SUM(p.valor_total_pedido)  FILTER (WHERE p.situacao = 2), 0),
--   COALESCE(SUM(p.valor_desconto)      FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
--   COALESCE(SUM(p.valor_frete)         FILTER (WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0),
--   now()
-- FROM pedidos p
-- LEFT JOIN (
--   SELECT pedido_id, SUM(quantidade) AS pecas
--   FROM pedido_itens
--   GROUP BY pedido_id
-- ) pi_sum ON pi_sum.pedido_id = p.id
-- WHERE p.ecommerce_nome IS NOT NULL
-- GROUP BY p.data_pedido, p.ecommerce_nome
-- ON CONFLICT (data_pedido, ecommerce_nome) DO UPDATE SET
--   faturamento    = EXCLUDED.faturamento,
--   pedidos        = EXCLUDED.pedidos,
--   pecas          = EXCLUDED.pecas,
--   cancelamentos  = EXCLUDED.cancelamentos,
--   fat_cancelado  = EXCLUDED.fat_cancelado,
--   valor_desconto = EXCLUDED.valor_desconto,
--   valor_frete    = EXCLUDED.valor_frete,
--   updated_at     = now();
--
-- ============================================================
-- DOWN (rollback):
-- DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_insert ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_update ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_daily_stats_refresh_delete ON pedidos;
-- DROP FUNCTION IF EXISTS trigger_refresh_daily_stats_insert();
-- DROP FUNCTION IF EXISTS trigger_refresh_daily_stats_update();
-- DROP FUNCTION IF EXISTS trigger_refresh_daily_stats_delete();
-- DROP FUNCTION IF EXISTS rpc_kpis_hero_v3(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_vendas_por_dia_v3(DATE, DATE, DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_kpis_secundarios_v3(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_ranking_lojas_v3(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_marketplace_v3(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_comparativo_periodos_v3(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS reconcile_daily_stats(INT);
-- DROP FUNCTION IF EXISTS refresh_daily_stats_for(DATE, TEXT);
-- DROP TABLE IF EXISTS dashboard_daily_stats;
