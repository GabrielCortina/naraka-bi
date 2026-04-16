-- ============================================================
-- 030_rpc_sku_detalhes_from_summary.sql
--
-- rpc_sku_detalhes ainda lia direto de pedidos — timeout em 7d+.
-- O summary dashboard_sku_daily_stats (028) já tem tudo exceto
-- descricao. Adicionamos a coluna, atualizamos o refresh, e
-- reescrevemos a RPC para ler do summary (<50ms).
-- ============================================================

-- 1. Adicionar coluna descricao ao summary existente
ALTER TABLE dashboard_sku_daily_stats
  ADD COLUMN IF NOT EXISTS descricao TEXT DEFAULT NULL;

-- 2. Reescrever refresh para popular descricao (MAX)
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
    faturamento, quantidade, pedidos_count, descricao, updated_at
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
           pi.descricao,
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
           ib.descricao,
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
    SELECT ke.pedido_id,
           ke.sku_step AS sku,
           ke.descricao,
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
    SELECT sku_pai, COUNT(DISTINCT pedido_id)::BIGINT AS pedidos_count
    FROM normalizado
    GROUP BY sku_pai
  ),
  por_sku AS (
    SELECT sku_pai, sku,
           SUM(valor_total)::NUMERIC AS faturamento,
           SUM(quantidade)::NUMERIC  AS quantidade,
           MAX(descricao)::TEXT      AS descricao
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
    ps.descricao,
    now()
  FROM por_sku ps
  JOIN por_sku_pai pp ON pp.sku_pai = ps.sku_pai;
END;
$$;

-- 3. Reescrever rpc_sku_detalhes lendo do summary
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
PARALLEL SAFE
AS $$
  SELECT
    s.sku,
    MAX(s.descricao)::TEXT      AS descricao,
    SUM(s.quantidade)::NUMERIC  AS quantidade,
    SUM(s.faturamento)::NUMERIC AS faturamento
  FROM dashboard_sku_daily_stats s
  WHERE s.sku_pai = p_sku_pai
    AND s.data_pedido BETWEEN p_start AND p_end
    AND (p_lojas IS NULL OR s.ecommerce_nome = ANY(p_lojas))
  GROUP BY s.sku
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- ATENÇÃO: Após aplicar esta migration, rodar backfill para
-- popular a coluna descricao nos dados históricos:
--   SELECT reconcile_sku_daily_stats(400);
-- (Reutiliza a função de reconciliação da 028, agora com descricao.)
-- ============================================================

-- DOWN:
-- ALTER TABLE dashboard_sku_daily_stats DROP COLUMN IF EXISTS descricao;
-- (Reaplicar rpc_sku_detalhes da 028 para restaurar versão anterior.)
