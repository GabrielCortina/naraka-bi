-- ============================================================
-- 029_dashboard_heatmap_stats.sql
--
-- Pré-agregação do heatmap (análoga às 024/028).
-- Motivação: rpc_heatmap era a ÚNICA RPC do Group 2 lendo direto de
-- pedidos — sob throttling do Supabase, estava travando o batch de
-- auto-refresh em timeout de 9s (fix paliativo em d677bdf tirou do
-- batch; agora resolvemos a causa raiz).
--
-- Grão: (data_pedido, ecommerce_nome, dia_semana, hora).
-- dia_semana e hora NÃO são deriváveis de data_pedido — vêm de
-- last_sync_at AT TIME ZONE 'America/Sao_Paulo' (idem rpc_heatmap
-- original). Por isso armazenamos explicitamente.
--
-- Preserva a semântica original 100% (last_sync_at → hora/DOW com
-- timezone SP). Polling/webhook intocados. Frontend intocado.
-- ============================================================

-- 1. Tabela summary
CREATE TABLE IF NOT EXISTS dashboard_heatmap_stats (
  data_pedido      DATE    NOT NULL,
  ecommerce_nome   TEXT    NOT NULL,
  dia_semana       INT     NOT NULL,  -- 0=dom ... 6=sáb
  hora             INT     NOT NULL,  -- 0..23
  total_pedidos    BIGINT  NOT NULL DEFAULT 0,
  total_faturamento NUMERIC NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (data_pedido, ecommerce_nome, dia_semana, hora)
);

CREATE INDEX IF NOT EXISTS idx_heatmap_stats_data
  ON dashboard_heatmap_stats (data_pedido);
CREATE INDEX IF NOT EXISTS idx_heatmap_stats_loja_data
  ON dashboard_heatmap_stats (ecommerce_nome, data_pedido);

GRANT SELECT ON dashboard_heatmap_stats TO anon, authenticated;

-- 2. Função de refresh por (data, loja)
-- Agrega pedidos aprovados com last_sync_at não-nulo, usando
-- timezone America/Sao_Paulo para DOW e HOUR (igual ao rpc_heatmap
-- original da 020).
CREATE OR REPLACE FUNCTION refresh_heatmap_stats_for(
  p_data           DATE,
  p_ecommerce_nome TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM dashboard_heatmap_stats
   WHERE data_pedido = p_data
     AND ecommerce_nome = p_ecommerce_nome;

  INSERT INTO dashboard_heatmap_stats (
    data_pedido, ecommerce_nome, dia_semana, hora,
    total_pedidos, total_faturamento, updated_at
  )
  SELECT
    p_data,
    p_ecommerce_nome,
    EXTRACT(DOW  FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    EXTRACT(HOUR FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(p.valor_total_pedido), 0)::NUMERIC,
    now()
  FROM pedidos p
  WHERE p.data_pedido     = p_data
    AND p.ecommerce_nome  = p_ecommerce_nome
    AND p.situacao        = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
    AND p.last_sync_at IS NOT NULL
  GROUP BY
    EXTRACT(DOW  FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
    EXTRACT(HOUR FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT;
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_heatmap_stats_for(DATE, TEXT) TO anon, authenticated;

-- 3. Trigger functions (statement-level com transition tables)
CREATE OR REPLACE FUNCTION trigger_refresh_heatmap_stats_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_heatmap_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM new_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_heatmap_stats_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_heatmap_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT data_pedido, ecommerce_nome FROM old_rows WHERE ecommerce_nome IS NOT NULL
    UNION
    SELECT data_pedido, ecommerce_nome FROM new_rows WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_refresh_heatmap_stats_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM refresh_heatmap_stats_for(t.data_pedido, t.ecommerce_nome)
  FROM (
    SELECT DISTINCT data_pedido, ecommerce_nome
    FROM old_rows
    WHERE ecommerce_nome IS NOT NULL
  ) t;
  RETURN NULL;
END;
$$;

-- 4. Triggers em pedidos (nomes próprios, sem colisão com 024/028)
DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_insert ON pedidos;
DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_update ON pedidos;
DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_delete ON pedidos;

CREATE TRIGGER pedidos_heatmap_stats_refresh_insert
  AFTER INSERT ON pedidos
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_heatmap_stats_insert();

CREATE TRIGGER pedidos_heatmap_stats_refresh_update
  AFTER UPDATE ON pedidos
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_heatmap_stats_update();

CREATE TRIGGER pedidos_heatmap_stats_refresh_delete
  AFTER DELETE ON pedidos
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION trigger_refresh_heatmap_stats_delete();

-- 5. Função de reconciliação (para backfill e recuperação manual)
CREATE OR REPLACE FUNCTION reconcile_heatmap_stats(
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
    PERFORM refresh_heatmap_stats_for(r.data_pedido, r.ecommerce_nome);
    data_pedido    := r.data_pedido;
    ecommerce_nome := r.ecommerce_nome;
    atualizado     := TRUE;
    RETURN NEXT;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_heatmap_stats(INT) TO anon, authenticated;

-- 6. Reescrever rpc_heatmap lendo do summary (LANGUAGE sql simples)
-- Assinatura PRESERVADA: (dia_semana INT, hora INT, contagem BIGINT, faturamento NUMERIC)
DROP FUNCTION IF EXISTS rpc_heatmap(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_heatmap(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  dia_semana  INT,
  hora        INT,
  contagem    BIGINT,
  faturamento NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
PARALLEL SAFE
AS $$
  SELECT
    h.dia_semana,
    h.hora,
    SUM(h.total_pedidos)::BIGINT       AS contagem,
    SUM(h.total_faturamento)::NUMERIC  AS faturamento
  FROM dashboard_heatmap_stats h
  WHERE h.data_pedido BETWEEN p_start AND p_end
    AND (p_lojas IS NULL OR h.ecommerce_nome = ANY(p_lojas))
  GROUP BY h.dia_semana, h.hora
$$;

GRANT EXECUTE ON FUNCTION rpc_heatmap(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- ATENÇÃO: Após aplicar esta migration, rodar SEPARADAMENTE o
-- arquivo 029_backfill_heatmap_stats.sql para popular os dados
-- históricos. Até o backfill terminar, rpc_heatmap retorna vazio
-- para períodos sem triggers acionados.
-- ============================================================

-- DOWN (rollback):
-- DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_insert ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_update ON pedidos;
-- DROP TRIGGER IF EXISTS pedidos_heatmap_stats_refresh_delete ON pedidos;
-- DROP FUNCTION IF EXISTS trigger_refresh_heatmap_stats_insert();
-- DROP FUNCTION IF EXISTS trigger_refresh_heatmap_stats_update();
-- DROP FUNCTION IF EXISTS trigger_refresh_heatmap_stats_delete();
-- DROP FUNCTION IF EXISTS reconcile_heatmap_stats(INT);
-- DROP FUNCTION IF EXISTS refresh_heatmap_stats_for(DATE, TEXT);
-- DROP FUNCTION IF EXISTS rpc_heatmap(DATE, DATE, TEXT[]);
-- DROP TABLE IF EXISTS dashboard_heatmap_stats;
-- (E reaplicar 020 + 023 para restaurar rpc_heatmap original)
