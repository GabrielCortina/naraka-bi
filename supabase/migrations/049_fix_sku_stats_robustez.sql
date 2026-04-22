-- ============================================================
-- 049_fix_sku_stats_robustez.sql
--
-- Corrige o erro "duplicate key value violates unique constraint
-- dashboard_sku_daily_stats_pkey" que ocorreu ao rodar o backfill
-- da migration 048. Duas causas possíveis, ambas blindadas aqui:
--
-- 1. Mesmo sku com sku_pai diferentes em `por_sku` (aliases em
--    sku_alias podem mapear o mesmo prefixo para canônicos
--    diferentes quando há linhas ativas redundantes). Como o PK
--    do summary é (data, ecommerce, sku) — sem sku_pai —, duas
--    linhas violam a chave.
--    Fix: CTE `por_sku_unique` com DISTINCT ON (sku) escolhe o
--    sku_pai de maior faturamento (determinístico).
--
-- 2. Race condition durante reconcile: se polling de pedidos
--    insere linhas novas e dispara o trigger que invoca refresh,
--    duas transações podem colidir no (data, ecommerce) em backfill.
--    Fix: INSERT ... ON CONFLICT DO UPDATE torna o refresh
--    idempotente.
--
-- Preserva o fator de rateio introduzido na 048.
-- Roda backfill completo ao final (daily 400d + hourly 30d).
-- ============================================================

-- 1. refresh_sku_daily_stats_for com dedupe + ON CONFLICT
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
    SELECT p.id,
           CASE
             WHEN p.valor_total_produtos > 0
               THEN GREATEST(
                      0,
                      LEAST(
                        1,
                        (p.valor_total_produtos - p.valor_desconto)
                          / p.valor_total_produtos
                      )
                    )
             ELSE 1
           END AS fator_ajuste
    FROM pedidos p
    WHERE p.data_pedido    = p_data
      AND p.ecommerce_nome = p_ecommerce_nome
      AND p.situacao IN (1,3,4,5,6,7,9)
  ),
  itens_brutos AS (
    SELECT pi.pedido_id,
           pi.sku,
           pi.descricao,
           pi.quantidade::NUMERIC                     AS quantidade,
           (pi.valor_total::NUMERIC * a.fator_ajuste) AS valor_total
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
  ),
  por_sku_unique AS (
    -- Garante 1 linha por sku — caso o mesmo sku apareça com
    -- sku_pai diferentes, escolhe o de maior faturamento.
    SELECT DISTINCT ON (ps.sku)
      ps.sku, ps.sku_pai, ps.faturamento, ps.quantidade, ps.descricao
    FROM por_sku ps
    ORDER BY ps.sku, ps.faturamento DESC, ps.sku_pai
  )
  SELECT
    p_data,
    p_ecommerce_nome,
    psu.sku,
    psu.sku_pai,
    psu.faturamento,
    psu.quantidade,
    pp.pedidos_count,
    psu.descricao,
    now()
  FROM por_sku_unique psu
  JOIN por_sku_pai pp ON pp.sku_pai = psu.sku_pai
  ON CONFLICT (data_pedido, ecommerce_nome, sku) DO UPDATE SET
    sku_pai       = EXCLUDED.sku_pai,
    faturamento   = EXCLUDED.faturamento,
    quantidade    = EXCLUDED.quantidade,
    pedidos_count = EXCLUDED.pedidos_count,
    descricao     = EXCLUDED.descricao,
    updated_at    = EXCLUDED.updated_at;
END;
$$;

-- 2. refresh_sku_hourly_stats_for com dedupe + ON CONFLICT
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
    SELECT p.id,
           CASE
             WHEN p.valor_total_produtos > 0
               THEN GREATEST(
                      0,
                      LEAST(
                        1,
                        (p.valor_total_produtos - p.valor_desconto)
                          / p.valor_total_produtos
                      )
                    )
             ELSE 1
           END AS fator_ajuste
    FROM pedidos p
    WHERE p.data_pedido    = p_data
      AND p.ecommerce_nome = p_ecommerce_nome
      AND p.situacao IN (1,3,4,5,6,7,9)
      AND EXTRACT(HOUR FROM (p.created_at AT TIME ZONE 'America/Sao_Paulo'))::INT = p_hora
  ),
  itens_brutos AS (
    SELECT pi.pedido_id, pi.sku, pi.descricao,
           pi.quantidade::NUMERIC                     AS quantidade,
           (pi.valor_total::NUMERIC * a.fator_ajuste) AS valor_total
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
  ),
  por_sku_unique AS (
    SELECT DISTINCT ON (ps.sku)
      ps.sku, ps.sku_pai, ps.faturamento, ps.quantidade, ps.descricao
    FROM por_sku ps
    ORDER BY ps.sku, ps.faturamento DESC, ps.sku_pai
  )
  SELECT p_data, p_hora, p_ecommerce_nome,
         psu.sku, psu.sku_pai, psu.quantidade, psu.faturamento,
         pp.pedidos_count, psu.descricao, now()
  FROM por_sku_unique psu
  JOIN por_sku_pai pp ON pp.sku_pai = psu.sku_pai
  ON CONFLICT (data_pedido, hora, ecommerce_nome, sku) DO UPDATE SET
    sku_pai       = EXCLUDED.sku_pai,
    quantidade    = EXCLUDED.quantidade,
    faturamento   = EXCLUDED.faturamento,
    pedidos_count = EXCLUDED.pedidos_count,
    descricao     = EXCLUDED.descricao,
    updated_at    = EXCLUDED.updated_at;
END;
$$;

-- 3. Backfill: limpa e reprocessa tudo. Rode as duas linhas
-- SEPARADAMENTE no SQL Editor do Supabase se preferir dar
-- feedback intermediário; ambas são idempotentes.
DELETE FROM dashboard_sku_daily_stats;
SELECT reconcile_sku_daily_stats(400);

DELETE FROM dashboard_sku_hourly_stats;
SELECT reconcile_sku_hourly_stats(30);
