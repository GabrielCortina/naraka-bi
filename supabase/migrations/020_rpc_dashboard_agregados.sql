-- ============================================================
-- 020_rpc_dashboard_agregados.sql
--
-- Substitui o padrão "buscar pedidos crus e agregar no JS"
-- por RPCs que retornam dados já agregados pelo Postgres.
--
-- Resultado esperado:
--   Antes: 3094 requests, 11 MB, 500 em períodos longos
--   Depois: ~8 requests, ~50 KB por refresh
--
-- Todas as RPCs:
--   - SECURITY DEFINER (bypass de RLS, pois agregam sem expor PII)
--   - SET search_path = public (evita hijack por schemas)
--   - STABLE (não muda estado, cacheable dentro de transação)
--   - Aceitam p_lojas TEXT[] com NULL = "todas as lojas"
--   - Usam SITUACOES_APROVADAS = [1,3,4,5,6,7,9] e CANCELADAS = [2]
-- ============================================================

-- Idempotência: remove versões anteriores antes de criar
DROP FUNCTION IF EXISTS rpc_kpis_hero(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_kpis_hero_anterior(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_vendas_por_dia(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_ranking_lojas(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_marketplace(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_heatmap(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_kpis_secundarios(DATE, DATE, TEXT[]);
DROP FUNCTION IF EXISTS rpc_comparativo_periodos(DATE, DATE, TEXT[]);

-- Índices de suporte (idempotentes)
CREATE INDEX IF NOT EXISTS idx_pedidos_situacao_data
  ON pedidos(situacao, data_pedido);
CREATE INDEX IF NOT EXISTS idx_pedidos_data_loja
  ON pedidos(data_pedido, ecommerce_nome);
CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido
  ON pedido_itens(pedido_id);

-- ============================================================
-- rpc_kpis_hero
-- Agrega faturamento, pedidos, peças, ticket, cancelamentos,
-- melhor dia, média diária e dias com venda para o período.
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_kpis_hero(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
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
AS $$
  WITH aprovados AS (
    SELECT p.id, p.data_pedido, p.valor_total_pedido
    FROM pedidos p
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  cancelados AS (
    SELECT p.valor_total_pedido
    FROM pedidos p
    WHERE p.situacao = 2
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  pecas_agg AS (
    SELECT COALESCE(SUM(pi.quantidade), 0)::NUMERIC AS pecas
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  por_dia AS (
    SELECT data_pedido, SUM(valor_total_pedido) AS fat
    FROM aprovados
    GROUP BY data_pedido
  ),
  melhor AS (
    SELECT data_pedido, fat FROM por_dia ORDER BY fat DESC LIMIT 1
  ),
  totais AS (
    SELECT
      COALESCE(SUM(valor_total_pedido), 0)::NUMERIC AS fat,
      COUNT(*)::BIGINT AS pedidos
    FROM aprovados
  )
  SELECT
    t.fat,
    t.pedidos,
    (SELECT pecas FROM pecas_agg),
    CASE WHEN t.pedidos > 0 THEN t.fat / t.pedidos ELSE 0 END,
    (SELECT COUNT(*) FROM cancelados)::BIGINT,
    COALESCE((SELECT SUM(valor_total_pedido) FROM cancelados), 0)::NUMERIC,
    (SELECT data_pedido FROM melhor),
    COALESCE((SELECT fat FROM melhor), 0)::NUMERIC,
    CASE WHEN (p_end - p_start + 1) > 0
         THEN t.fat / (p_end - p_start + 1)
         ELSE 0
    END,
    (SELECT COUNT(*) FROM por_dia)::INT
  FROM totais t
$$;

GRANT EXECUTE ON FUNCTION rpc_kpis_hero(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_kpis_hero_anterior
-- Mesmos agregados para o período anterior de mesma duração.
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_kpis_hero_anterior(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
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
AS $$
  SELECT * FROM rpc_kpis_hero(
    (p_start - (p_end - p_start + 1))::DATE,
    (p_start - 1)::DATE,
    p_lojas
  )
$$;

GRANT EXECUTE ON FUNCTION rpc_kpis_hero_anterior(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_vendas_por_dia
-- Linha por dia com faturamento, pedidos, cancelamentos, peças
-- e ticket médio. Substitui o getVendasPorDia chamado 3× hoje.
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_vendas_por_dia(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
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
AS $$
  WITH base AS (
    SELECT p.id, p.data_pedido, p.valor_total_pedido, p.situacao
    FROM pedidos p
    WHERE p.data_pedido BETWEEN p_start AND p_end
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
    b.data_pedido,
    COALESCE(SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))::BIGINT,
    COUNT(*) FILTER (WHERE b.situacao = 2)::BIGINT,
    COALESCE(SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = 2), 0)::NUMERIC,
    COALESCE(SUM(pp.q) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    CASE
      WHEN COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])) > 0
      THEN (SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])))::NUMERIC
           / COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))
      ELSE 0
    END
  FROM base b
  LEFT JOIN pecas_por_pedido pp ON pp.pedido_id = b.id
  GROUP BY b.data_pedido
  ORDER BY b.data_pedido
$$;

GRANT EXECUTE ON FUNCTION rpc_vendas_por_dia(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_top_skus
-- Agrupa por SKU pai (dígitos iniciais do SKU) com variações,
-- faturamento, peças e pedidos. Inclui JSONB com variações
-- detalhadas para o modal (evita roundtrip de getSkuDetalhes).
-- ============================================================
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
  variacoes    TEXT[],
  skus_filhos  JSONB
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
      pi.descricao,
      pi.quantidade,
      pi.valor_total,
      COALESCE(substring(pi.sku from '^[0-9]+'), pi.sku) AS sku_pai
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  por_sku AS (
    SELECT
      sku_pai,
      sku,
      MAX(descricao)        AS descricao,
      SUM(quantidade)::NUMERIC AS quantidade,
      SUM(valor_total)::NUMERIC AS faturamento
    FROM itens
    GROUP BY sku_pai, sku
  )
  SELECT
    ps.sku_pai,
    SUM(ps.faturamento)::NUMERIC AS faturamento,
    SUM(ps.quantidade)::NUMERIC  AS pecas,
    (SELECT COUNT(DISTINCT i2.pedido_id)::BIGINT FROM itens i2 WHERE i2.sku_pai = ps.sku_pai) AS pedidos,
    array_agg(ps.sku ORDER BY ps.sku) AS variacoes,
    jsonb_agg(
      jsonb_build_object(
        'sku', ps.sku,
        'descricao', ps.descricao,
        'quantidade', ps.quantidade,
        'faturamento', ps.faturamento
      ) ORDER BY ps.faturamento DESC
    ) AS skus_filhos
  FROM por_sku ps
  GROUP BY ps.sku_pai
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_ranking_lojas
-- Linha por ecommerce_nome com resolução de nome_loja e
-- marketplace via loja_config (LEFT JOIN — sem quebrar para
-- lojas sem config).
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_ranking_lojas(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT p.id, p.ecommerce_nome, p.valor_total_pedido, p.situacao
    FROM pedidos p
    WHERE p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
      AND p.situacao = ANY(ARRAY[1,2,3,4,5,6,7,9]::SMALLINT[])
  ),
  pecas_agg AS (
    SELECT pi.pedido_id, SUM(pi.quantidade) AS q
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM base)
    GROUP BY pi.pedido_id
  )
  SELECT
    COALESCE(b.ecommerce_nome, 'Sem loja'),
    COALESCE(lc.nome_loja, lc.nome_exibicao, b.ecommerce_nome, 'Sem loja'),
    COALESCE(lc.marketplace, ''),
    COALESCE(SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))::BIGINT,
    COALESCE(SUM(pa.q) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC,
    CASE
      WHEN COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])) > 0
      THEN (SUM(b.valor_total_pedido) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])))::NUMERIC
           / COUNT(*) FILTER (WHERE b.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))
      ELSE 0
    END,
    COUNT(*) FILTER (WHERE b.situacao = 2)::BIGINT,
    CASE
      WHEN COUNT(*) > 0
      THEN (COUNT(*) FILTER (WHERE b.situacao = 2))::NUMERIC / COUNT(*)::NUMERIC * 100
      ELSE 0
    END
  FROM base b
  LEFT JOIN pecas_agg pa   ON pa.pedido_id = b.id
  LEFT JOIN loja_config lc ON lc.ecommerce_nome_tiny = b.ecommerce_nome
  GROUP BY b.ecommerce_nome, lc.nome_loja, lc.nome_exibicao, lc.marketplace
  ORDER BY 4 DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_ranking_lojas(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_marketplace
-- Agrega por marketplace (resolvido via loja_config).
-- Pedidos sem config caem em "outro".
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_marketplace(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      COALESCE(lc.marketplace, 'outro') AS mp,
      p.valor_total_pedido
    FROM pedidos p
    LEFT JOIN loja_config lc ON lc.ecommerce_nome_tiny = p.ecommerce_nome
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  total AS (
    SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC AS t FROM base
  )
  SELECT
    b.mp::TEXT,
    COALESCE(SUM(b.valor_total_pedido), 0)::NUMERIC,
    COUNT(*)::BIGINT,
    CASE
      WHEN (SELECT t FROM total) > 0
      THEN (SUM(b.valor_total_pedido) / (SELECT t FROM total) * 100)::NUMERIC
      ELSE 0
    END
  FROM base b
  GROUP BY b.mp
  ORDER BY 2 DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_marketplace(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_heatmap
-- Agrega por (dia_semana, hora) usando last_sync_at convertido
-- para America/Sao_Paulo no Postgres (corrige bug do
-- `new Date(toLocaleString(...))` client-side).
--
-- NOTA: last_sync_at é o momento do sync com o Tiny, NÃO o
-- momento da venda. Mantido por compatibilidade com heatmap
-- atual enquanto não houver campo de hora da venda.
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_heatmap(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  dia_semana   INT,
  hora         INT,
  contagem     BIGINT,
  faturamento  NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    EXTRACT(DOW  FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    EXTRACT(HOUR FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(p.valor_total_pedido), 0)::NUMERIC
  FROM pedidos p
  WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND p.data_pedido BETWEEN p_start AND p_end
    AND p.last_sync_at IS NOT NULL
    AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  GROUP BY 1, 2
$$;

GRANT EXECUTE ON FUNCTION rpc_heatmap(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_kpis_secundarios
-- Métricas financeiras: faturamento bruto/líquido, desconto,
-- frete (valor e %), taxa de cancelamento, fat. cancelado.
-- Campos adicionais não consumidos pela UI atual — ficam
-- disponíveis para a próxima iteração.
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_kpis_secundarios(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
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
AS $$
  WITH base AS (
    SELECT
      p.valor_total_pedido,
      p.valor_desconto,
      p.valor_frete,
      p.situacao
    FROM pedidos p
    WHERE p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
      AND p.situacao = ANY(ARRAY[1,2,3,4,5,6,7,9]::SMALLINT[])
  ),
  agg AS (
    SELECT
      COALESCE(SUM(valor_total_pedido) FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC AS fat_bruto,
      COALESCE(SUM(valor_desconto)     FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC AS desconto,
      COALESCE(SUM(valor_frete)        FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])), 0)::NUMERIC AS frete,
      COUNT(*) FILTER (WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[]))::NUMERIC AS n_aprov,
      COUNT(*) FILTER (WHERE situacao = 2)::NUMERIC AS n_canc,
      COALESCE(SUM(valor_total_pedido) FILTER (WHERE situacao = 2), 0)::NUMERIC AS fat_canc
    FROM base
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

GRANT EXECUTE ON FUNCTION rpc_kpis_secundarios(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- rpc_comparativo_periodos
-- 3 linhas: Semana/Mês/Quinzena atual vs períodos anteriores.
-- Respeita filtro de loja (corrige bug onde o comparativo
-- ignorava o filtro).
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_comparativo_periodos(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_hoje DATE := CURRENT_DATE;
  v_dow  INT  := EXTRACT(DOW FROM CURRENT_DATE)::INT;
  v_dia  INT  := EXTRACT(DAY FROM CURRENT_DATE)::INT;

  v_sem_ini     DATE;
  v_sem_ant_ini DATE;
  v_sem_ant_fim DATE;

  v_mes_ini     DATE := date_trunc('month', v_hoje)::DATE;
  v_mes_ant_ini DATE;
  v_mes_ant_fim DATE;

  v_quinz_ini     DATE;
  v_quinz_ant_ini DATE;
  v_quinz_ant_fim DATE;

  v_sem_at    NUMERIC;
  v_sem_ant   NUMERIC;
  v_mes_at    NUMERIC;
  v_mes_ant   NUMERIC;
  v_quinz_at  NUMERIC;
  v_quinz_ant NUMERIC;
BEGIN
  v_sem_ini     := v_hoje - (CASE WHEN v_dow = 0 THEN 6 ELSE v_dow - 1 END);
  v_sem_ant_ini := v_sem_ini - 7;
  v_sem_ant_fim := v_hoje - 7;

  v_mes_ant_ini := (v_mes_ini - INTERVAL '1 month')::DATE;
  v_mes_ant_fim := (v_mes_ant_ini + (v_dia - 1))::DATE;

  IF v_dia <= 15 THEN
    v_quinz_ini     := v_mes_ini;
    v_quinz_ant_ini := v_mes_ant_ini + 15;
    v_quinz_ant_fim := v_quinz_ant_ini + (v_dia - 1);
  ELSE
    v_quinz_ini     := v_mes_ini + 15;
    v_quinz_ant_ini := v_mes_ini;
    v_quinz_ant_fim := v_mes_ini + (v_dia - 16);
  END IF;

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_sem_at
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_sem_ini AND v_hoje
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_sem_ant
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_sem_ant_ini AND v_sem_ant_fim
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_mes_at
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_mes_ini AND v_hoje
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_mes_ant
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_mes_ant_ini AND v_mes_ant_fim
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_quinz_at
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_quinz_ini AND v_hoje
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  SELECT COALESCE(SUM(valor_total_pedido), 0)::NUMERIC INTO v_quinz_ant
  FROM pedidos
  WHERE situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND data_pedido BETWEEN v_quinz_ant_ini AND v_quinz_ant_fim
    AND (p_lojas IS NULL OR ecommerce_nome = ANY(p_lojas));

  RETURN QUERY
  SELECT * FROM (VALUES
    ('Semana atual'::TEXT,
     (to_char(v_sem_ini, 'DD/MM') || ' – ' || to_char(v_hoje, 'DD/MM'))::TEXT,
     v_sem_at, v_sem_ant,
     (CASE WHEN v_sem_ant > 0 THEN (v_sem_at - v_sem_ant) / v_sem_ant * 100
           WHEN v_sem_at > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END)),
    ('Mês atual'::TEXT,
     (to_char(v_mes_ini, 'DD/MM') || ' – ' || to_char(v_hoje, 'DD/MM'))::TEXT,
     v_mes_at, v_mes_ant,
     (CASE WHEN v_mes_ant > 0 THEN (v_mes_at - v_mes_ant) / v_mes_ant * 100
           WHEN v_mes_at > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END)),
    ('Quinzena atual'::TEXT,
     (to_char(v_quinz_ini, 'DD/MM') || ' – ' || to_char(v_hoje, 'DD/MM'))::TEXT,
     v_quinz_at, v_quinz_ant,
     (CASE WHEN v_quinz_ant > 0 THEN (v_quinz_at - v_quinz_ant) / v_quinz_ant * 100
           WHEN v_quinz_at > 0 THEN 100::NUMERIC ELSE 0::NUMERIC END))
  ) AS t(nome, date_range, valor, valor_comparado, variacao);
END
$$;

GRANT EXECUTE ON FUNCTION rpc_comparativo_periodos(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- DOWN (rollback) — descomentar e executar para reverter:
-- DROP FUNCTION IF EXISTS rpc_kpis_hero(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_kpis_hero_anterior(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_vendas_por_dia(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_ranking_lojas(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_marketplace(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_heatmap(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_kpis_secundarios(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_comparativo_periodos(DATE, DATE, TEXT[]);
-- DROP INDEX IF EXISTS idx_pedidos_situacao_data;
-- DROP INDEX IF EXISTS idx_pedidos_data_loja;
-- DROP INDEX IF EXISTS idx_pedido_itens_pedido;
