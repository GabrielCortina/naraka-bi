-- ============================================================
-- 028_dashboard_sku_daily_stats.sql
--
-- Pré-agregação por SKU (análoga à 024 para KPIs hero/ranking).
-- Motivação: rpc_top_skus estava estourando timeout porque lia
-- pedidos + pedido_itens + explosão de kits + alias em tempo real.
-- O diagnóstico final (multi-agente) concluiu que não há tunning
-- de query que resolva dentro da infraestrutura atual: o Bitmap
-- Heap Scan sobre ~16k blocos em cache demora 5–11s (compatível
-- com throttling de I/O de container). Solução: materializar.
--
-- Grão: (data_pedido, ecommerce_nome, sku).
-- sku_pai, faturamento e quantidade são por SKU filho.
-- pedidos_count é replicado entre os SKUs do mesmo sku_pai da
-- mesma (data, loja) — representa COUNT(DISTINCT pedido_id) dentro
-- daquele sku_pai naquela janela. A RPC soma-o via subquery
-- DISTINCT para evitar dupla contagem.
--
-- Preserva toda a lógica de kits (explosão) e alias (prefixo) da
-- migration 026 — não altera polling/webhook nem frontend.
-- ============================================================

-- 1. Remove o índice parcial da tentativa anterior (não mais usado)
DROP INDEX IF EXISTS idx_pedidos_aprovados_data;

-- 2. Tabela summary
CREATE TABLE IF NOT EXISTS dashboard_sku_daily_stats (
  data_pedido    DATE    NOT NULL,
  ecommerce_nome TEXT    NOT NULL,
  sku            TEXT    NOT NULL,
  sku_pai        TEXT    NOT NULL,
  faturamento    NUMERIC NOT NULL DEFAULT 0,
  quantidade     NUMERIC NOT NULL DEFAULT 0,
  pedidos_count  BIGINT  NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_pedido, ecommerce_nome, sku)
);

CREATE INDEX IF NOT EXISTS idx_sku_stats_data
  ON dashboard_sku_daily_stats (data_pedido);
CREATE INDEX IF NOT EXISTS idx_sku_stats_sku_pai_data
  ON dashboard_sku_daily_stats (sku_pai, data_pedido);
CREATE INDEX IF NOT EXISTS idx_sku_stats_loja_data
  ON dashboard_sku_daily_stats (ecommerce_nome, data_pedido);

GRANT SELECT ON dashboard_sku_daily_stats TO anon, authenticated;

-- 3. Função de refresh por (data, loja)
CREATE OR REPLACE FUNCTION refresh_sku_daily_stats_for(
  p_data           DATE,
  p_ecommerce_nome TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM dashboard_sku_daily_stats
   WHERE data_pedido = p_data
     AND ecommerce_nome = p_ecommerce_nome;

  INSERT INTO dashboard_sku_daily_stats (
    data_pedido, ecommerce_nome, sku, sku_pai,
    faturamento, quantidade, pedidos_count, updated_at
  )
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.data_pedido    = p_data
      AND p.ecommerce_nome = p_ecommerce_nome
      AND p.situacao IN (1,3,4,5,6,7,9)
  ),
  itens_brutos AS (
    SELECT pi.pedido_id,
           pi.sku,
           pi.quantidade::NUMERIC  AS quantidade,
           pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    JOIN aprovados a ON a.id = pi.pedido_id
  ),
  kit_componentes AS (
    SELECT sk.sku_kit,
           sk.sku_componente,
           sk.quantidade,
           COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT ib.pedido_id,
           kc.sku_componente                            AS sku_step,
           (ib.quantidade * kc.quantidade)::NUMERIC     AS quantidade,
           (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT ib.pedido_id, ib.sku, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    LEFT JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    WHERE kc.sku_kit IS NULL
  ),
  normalizado AS (
    SELECT ke.pedido_id,
           ke.sku_step AS sku,
           ke.quantidade,
           ke.valor_total,
           COALESCE(
             substring(sa.sku_canonico FROM '^[0-9]+'),
             sa.sku_canonico,
             substring(ke.sku_step FROM '^[0-9]+'),
             ke.sku_step
           ) AS sku_pai
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = COALESCE(substring(ke.sku_step FROM '^[0-9]+'), ke.sku_step)
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  ),
  por_sku_pai AS (
    -- Contagem distinta de pedidos por sku_pai nessa (data, loja).
    -- Valor será replicado entre as linhas filhas.
    SELECT sku_pai, COUNT(DISTINCT pedido_id)::BIGINT AS pedidos_count
    FROM normalizado
    GROUP BY sku_pai
  ),
  por_sku AS (
    SELECT sku_pai, sku,
           SUM(valor_total)::NUMERIC AS faturamento,
           SUM(quantidade)::NUMERIC  AS quantidade
    FROM normalizado
    GROUP BY sku_pai, sku
  )
  SELECT
    p_data,
    p_ecommerce_nome,
    ps.sku,
    ps.sku_pai,
    ps.faturamento,
    ps.quantidade,
    pp.pedidos_count,
    now()
  FROM por_sku ps
  JOIN por_sku_pai pp ON pp.sku_pai = ps.sku_pai;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_sku_daily_stats_for(DATE, TEXT) TO anon, authenticated;

-- 4. Trigger functions (statement-level com transition tables)
CREATE OR REPLACE FUNCTION trigger_refresh_sku_stats_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_sku_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM new_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_sku_stats_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_sku_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT data_pedido, ecommerce_nome FROM old_rows WHERE ecommerce_nome IS NOT NULL
    UNION
    SELECT data_pedido, ecommerce_nome FROM new_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_sku_stats_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_sku_daily_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM old_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

-- 5. Triggers em pedidos (separados dos triggers da 024 via nomes distintos)
DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_insert ON pedidos;
DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_update ON pedidos;
DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_delete ON pedidos;

CREATE TRIGGER pedidos_sku_stats_refresh_insert
  AFTER INSERT ON pedidos
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_sku_stats_insert();

CREATE TRIGGER pedidos_sku_stats_refresh_update
  AFTER UPDATE ON pedidos
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_sku_stats_update();

CREATE TRIGGER pedidos_sku_stats_refresh_delete
  AFTER DELETE ON pedidos
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_sku_stats_delete();

-- 6. Função de reconciliação (análoga à reconcile_daily_stats)
-- Para uso após cadastro/edição de sku_kit ou sku_alias (regras
-- retroativas) ou se os triggers falharem silenciosamente.
CREATE OR REPLACE FUNCTION reconcile_sku_daily_stats(
  p_days_back INT DEFAULT 30
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
    PERFORM refresh_sku_daily_stats_for(r.data_pedido, r.ecommerce_nome);
    data_pedido    := r.data_pedido;
    ecommerce_nome := r.ecommerce_nome;
    atualizado     := TRUE;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_sku_daily_stats(INT) TO anon, authenticated;

-- 7. Reescrever rpc_top_skus lendo do summary (LANGUAGE sql simples)
DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_top_skus(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku_pai     TEXT,
  faturamento NUMERIC,
  pecas       NUMERIC,
  pedidos     BIGINT,
  variacoes   TEXT[]
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  WITH por_sku AS (
    SELECT s.sku_pai, s.sku,
           SUM(s.faturamento)::NUMERIC AS faturamento,
           SUM(s.quantidade)::NUMERIC  AS quantidade
    FROM dashboard_sku_daily_stats s
    WHERE s.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    GROUP BY s.sku_pai, s.sku
  ),
  por_sku_pai AS (
    -- pedidos_count é idêntico para todas as linhas do mesmo
    -- (data, loja, sku_pai); DISTINCT evita multiplicação pelos
    -- SKUs filhos antes de somar entre datas/lojas.
    SELECT sku_pai, SUM(pedidos_count)::BIGINT AS pedidos
    FROM (
      SELECT DISTINCT s.data_pedido, s.ecommerce_nome, s.sku_pai, s.pedidos_count
      FROM dashboard_sku_daily_stats s
      WHERE s.data_pedido BETWEEN p_start AND p_end
        AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
    ) t
    GROUP BY sku_pai
  )
  SELECT ps.sku_pai,
         ROUND(SUM(ps.faturamento)::NUMERIC, 2) AS faturamento,
         SUM(ps.quantidade)::NUMERIC            AS pecas,
         pp.pedidos                             AS pedidos,
         array_agg(DISTINCT ps.sku ORDER BY ps.sku) AS variacoes
  FROM por_sku ps
  JOIN por_sku_pai pp ON pp.sku_pai = ps.sku_pai
  GROUP BY ps.sku_pai, pp.pedidos
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) TO anon, authenticated;

-- 8. Reverter rpc_sku_detalhes para LANGUAGE sql simples
-- (sem enable_seqscan=off, force_custom_plan, plpgsql).
-- Continua lendo direto das tabelas originais — chamada pontual,
-- não precisa do summary.
DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_detalhes(
  p_sku_pai TEXT,
  p_start   DATE,
  p_end     DATE,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku         TEXT,
  descricao   TEXT,
  quantidade  NUMERIC,
  faturamento NUMERIC
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
  itens_brutos AS (
    SELECT pi.pedido_id, pi.sku, pi.descricao,
           pi.quantidade::NUMERIC  AS quantidade,
           pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  kit_componentes AS (
    SELECT sk.sku_kit, sk.sku_componente, sk.quantidade,
           COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT ib.pedido_id, kc.sku_componente AS sku_step, ib.descricao,
           (ib.quantidade * kc.quantidade)::NUMERIC AS quantidade,
           (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT ib.pedido_id, ib.sku, ib.descricao, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    LEFT JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    WHERE kc.sku_kit IS NULL
  ),
  itens_normalizados AS (
    SELECT ke.pedido_id, ke.sku_step AS sku, ke.descricao,
           ke.quantidade, ke.valor_total,
           COALESCE(
             substring(sa.sku_canonico FROM '^[0-9]+'),
             sa.sku_canonico,
             substring(ke.sku_step FROM '^[0-9]+'),
             ke.sku_step
           ) AS sku_pai_calc
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico FROM sku_alias a
      WHERE a.ativo
        AND a.sku_original = COALESCE(substring(ke.sku_step FROM '^[0-9]+'), ke.sku_step)
      ORDER BY a.canal NULLS LAST LIMIT 1
    ) sa ON true
  )
  SELECT inn.sku,
         MAX(inn.descricao)::TEXT      AS descricao,
         SUM(inn.quantidade)::NUMERIC  AS quantidade,
         SUM(inn.valor_total)::NUMERIC AS faturamento
  FROM itens_normalizados inn
  WHERE inn.sku_pai_calc = p_sku_pai
  GROUP BY inn.sku
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- ATENÇÃO: Após aplicar esta migration, rodar SEPARADAMENTE o
-- arquivo 028_backfill_sku_stats.sql para popular os dados
-- históricos. Até o backfill terminar, rpc_top_skus retorna
-- vazio para períodos sem triggers acionados.
-- ============================================================

-- DOWN (rollback):
-- DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_insert ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_update ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_sku_stats_refresh_delete ON pedidos;
-- DROP FUNCTION IF EXISTS trigger_refresh_sku_stats_insert();
-- DROP FUNCTION IF EXISTS trigger_refresh_sku_stats_update();
-- DROP FUNCTION IF EXISTS trigger_refresh_sku_stats_delete();
-- DROP FUNCTION IF EXISTS reconcile_sku_daily_stats(INT);
-- DROP FUNCTION IF EXISTS refresh_sku_daily_stats_for(DATE, TEXT);
-- DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);
-- DROP TABLE IF EXISTS dashboard_sku_daily_stats;
-- (E reaplicar 026 para restaurar versão anterior das RPCs)
