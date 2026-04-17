-- ============================================================
-- 037_rpc_sku_modal.sql
--
-- RPCs que alimentam o modal de detalhes do SKU (aba Alertas).
-- Todas leem de dashboard_sku_daily_stats — zero leitura em
-- pedidos/pedido_itens. Usa o padrão out_* para colunas de
-- RETURNS TABLE e respeita o ALLOWED_RPCS.
-- ============================================================

-- 1. Série temporal: soma de qtd/faturamento/pedidos por dia
-- DROP com todas as assinaturas possíveis (dev tinha variações).
DROP FUNCTION IF EXISTS rpc_sku_modal_serie_temporal(TEXT, DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_sku_modal_serie_temporal(TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION rpc_sku_modal_serie_temporal(
  p_sku_pai     TEXT,
  p_data_inicio DATE,
  p_data_fim    DATE,
  p_lojas       TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_data        DATE,
  out_quantidade  NUMERIC,
  out_faturamento NUMERIC,
  out_pedidos     BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.data_pedido                       AS out_data,
    COALESCE(SUM(s.quantidade), 0)      AS out_quantidade,
    COALESCE(SUM(s.faturamento), 0)     AS out_faturamento,
    COALESCE(SUM(s.pedidos_count), 0)::BIGINT AS out_pedidos
  FROM dashboard_sku_daily_stats s
  WHERE s.sku_pai = p_sku_pai
    AND s.data_pedido BETWEEN p_data_inicio AND p_data_fim
    AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  GROUP BY s.data_pedido
  ORDER BY s.data_pedido ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_serie_temporal(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- 2. Breakdown por loja com variação vs período anterior do mesmo tamanho.
-- p_lojas é aceito (mas ignorado, sempre queremos ver todas para comparar)
-- porque a rota /api/dashboard/rpc sempre injeta esse parâmetro.
DROP FUNCTION IF EXISTS rpc_sku_modal_por_loja(TEXT, DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_sku_modal_por_loja(TEXT, DATE, DATE);

CREATE OR REPLACE FUNCTION rpc_sku_modal_por_loja(
  p_sku_pai     TEXT,
  p_data_inicio DATE,
  p_data_fim    DATE,
  p_lojas       TEXT[] DEFAULT NULL
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
  v_dias INT;
BEGIN
  v_dias := (p_data_fim - p_data_inicio) + 1;

  RETURN QUERY
  WITH atual AS (
    SELECT
      s.ecommerce_nome               AS loja,
      COALESCE(SUM(s.quantidade), 0)  AS quantidade,
      COALESCE(SUM(s.faturamento), 0) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.sku_pai = p_sku_pai
      AND s.data_pedido BETWEEN p_data_inicio AND p_data_fim
    GROUP BY s.ecommerce_nome
  ),
  anterior AS (
    SELECT
      s.ecommerce_nome               AS loja,
      COALESCE(SUM(s.faturamento), 0) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.sku_pai = p_sku_pai
      AND s.data_pedido BETWEEN (p_data_inicio - v_dias) AND (p_data_inicio - 1)
    GROUP BY s.ecommerce_nome
  )
  SELECT
    a.loja                                              AS out_loja,
    a.quantidade                                        AS out_quantidade,
    a.faturamento                                       AS out_faturamento,
    CASE
      WHEN COALESCE(ant.faturamento, 0) = 0 THEN NULL
      ELSE ROUND(((a.faturamento - ant.faturamento) / ant.faturamento) * 100, 1)
    END                                                 AS out_variacao_percent
  FROM atual a
  LEFT JOIN anterior ant ON ant.loja = a.loja
  ORDER BY a.faturamento DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_por_loja(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- 3. KPIs: período selecionado vs período anterior de mesmo tamanho.
-- Substitui a versão antiga que era hardcoded "mês atual vs mês anterior".
DROP FUNCTION IF EXISTS rpc_sku_modal_kpis(TEXT, TEXT[]);
DROP FUNCTION IF EXISTS rpc_sku_modal_kpis(TEXT, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_modal_kpis(
  p_sku_pai     TEXT,
  p_data_inicio DATE,
  p_data_fim    DATE,
  p_lojas       TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_vendas              NUMERIC,
  out_vendas_anterior     NUMERIC,
  out_faturamento         NUMERIC,
  out_faturamento_anterior NUMERIC,
  out_ticket_medio        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_dias INT;
BEGIN
  v_dias := (p_data_fim - p_data_inicio) + 1;

  RETURN QUERY
  WITH atual AS (
    SELECT
      COALESCE(SUM(s.quantidade), 0)  AS vendas,
      COALESCE(SUM(s.faturamento), 0) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.sku_pai = p_sku_pai
      AND s.data_pedido BETWEEN p_data_inicio AND p_data_fim
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  ),
  anterior AS (
    SELECT
      COALESCE(SUM(s.quantidade), 0)  AS vendas,
      COALESCE(SUM(s.faturamento), 0) AS faturamento
    FROM dashboard_sku_daily_stats s
    WHERE s.sku_pai = p_sku_pai
      AND s.data_pedido BETWEEN (p_data_inicio - v_dias) AND (p_data_inicio - 1)
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  )
  SELECT
    a.vendas,
    ant.vendas,
    a.faturamento,
    ant.faturamento,
    CASE
      WHEN a.vendas = 0 THEN 0
      ELSE ROUND(a.faturamento / a.vendas, 2)
    END
  FROM atual a, anterior ant;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_kpis(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- 4. Impacto da alteração: média de vendas 3 dias antes vs 3 dias depois
-- p_lojas é aceito (mas ignorado) porque a rota /api/dashboard/rpc
-- sempre injeta esse parâmetro.
DROP FUNCTION IF EXISTS rpc_sku_modal_impacto_alteracao(TEXT, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_sku_modal_impacto_alteracao(TEXT, DATE);

CREATE OR REPLACE FUNCTION rpc_sku_modal_impacto_alteracao(
  p_sku            TEXT,
  p_data_alteracao DATE,
  p_lojas          TEXT[] DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_antes  NUMERIC;
  v_depois NUMERIC;
BEGIN
  SELECT COALESCE(AVG(s.quantidade), 0) INTO v_antes
  FROM dashboard_sku_daily_stats s
  WHERE (s.sku_pai = p_sku OR s.sku = p_sku)
    AND s.data_pedido BETWEEN (p_data_alteracao - 3) AND (p_data_alteracao - 1);

  SELECT COALESCE(AVG(s.quantidade), 0) INTO v_depois
  FROM dashboard_sku_daily_stats s
  WHERE (s.sku_pai = p_sku OR s.sku = p_sku)
    AND s.data_pedido BETWEEN (p_data_alteracao + 1) AND (p_data_alteracao + 3);

  IF v_antes = 0 THEN
    RETURN NULL;
  END IF;

  RETURN ROUND(((v_depois - v_antes) / v_antes) * 100, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_modal_impacto_alteracao(TEXT, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- 5. Hotfix: rpc_alteracoes_por_sku (migration 036) não aceitava
-- p_lojas. A rota /api/dashboard/rpc injeta esse parâmetro
-- automaticamente, então sem isso a chamada quebrava.
-- Aceito mas ignorado — alterações são sempre retornadas.
-- ============================================================
DROP FUNCTION IF EXISTS rpc_alteracoes_por_sku(TEXT, INT, TEXT[]);
DROP FUNCTION IF EXISTS rpc_alteracoes_por_sku(TEXT, INT);

CREATE OR REPLACE FUNCTION rpc_alteracoes_por_sku(
  p_sku        TEXT,
  p_dias_atras INT    DEFAULT 30,
  p_lojas      TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  out_id             UUID,
  out_data_alteracao DATE,
  out_tipo_alteracao TEXT,
  out_lojas          TEXT[],
  out_valor_antes    TEXT,
  out_valor_depois   TEXT,
  out_motivo         TEXT,
  out_observacao     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.data_alteracao,
    a.tipo_alteracao,
    a.lojas,
    a.valor_antes,
    a.valor_depois,
    a.motivo,
    a.observacao
  FROM alteracoes_anuncio a
  WHERE a.excluido_em IS NULL
    AND (a.sku = p_sku OR a.sku = split_part(p_sku, '-', 1))
    AND a.data_alteracao >= CURRENT_DATE - p_dias_atras
  ORDER BY a.data_alteracao DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alteracoes_por_sku(TEXT, INT, TEXT[]) TO anon, authenticated;
