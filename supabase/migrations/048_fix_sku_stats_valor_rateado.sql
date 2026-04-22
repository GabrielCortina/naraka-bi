-- ============================================================
-- 048_fix_sku_stats_valor_rateado.sql
--
-- Bug: modal de Top SKUs mostrava faturamento inflado para
-- pedidos do TikTok Shop. O TikTok envia pedido_itens.valor_unitario
-- como preço CHEIO (ex: R$ 109,99) e coloca o desconto apenas em
-- pedidos.valor_desconto (ex: R$ 75,00), resultando em valor_total
-- do item = 109,99 quando o pedido real foi R$ 34,99.
--
-- Os summaries dashboard_sku_daily_stats e dashboard_sku_hourly_stats
-- eram populados somando pi.valor_total direto — logo, faturamento
-- por SKU ficava inflado para TikTok. Shopee e outros canais que
-- já entregam valor_unitario descontado (valor_desconto = 0) não
-- eram afetados.
--
-- Correção: aplicar fator de rateio por pedido nas funções de refresh.
--   fator = (valor_total_produtos - valor_desconto) / valor_total_produtos
--   valor_item_ajustado = pi.valor_total * fator
--
-- - Sem desconto (Shopee, etc): fator = 1, comportamento inalterado.
-- - Com desconto (TikTok): fator < 1, desconto é distribuído
--   proporcionalmente ao peso do item no pedido.
-- - Frete/outras despesas ficam de fora (alvo é valor_total_produtos,
--   não valor_total_pedido) — faturamento do SKU é só produto.
--
-- Afeta todos os consumidores dos summaries:
--   - rpc_sku_detalhes (modal Top SKUs)  — alvo principal do fix
--   - rpc_top_skus (lista Top SKUs)      — deflacionado junto
--   - rpc_sku_modal_* (aba Alertas)      — deflacionado junto
--   - rpc_alertas_calcular_hoje          — deflacionado junto
--
-- KPIs hero (faturamento total, ticket médio, pedidos) leem de
-- dashboard_daily_stats (migration 024) — tabela diferente, não
-- afetada por esta migration.
-- ============================================================

-- 1. Reescrever refresh_sku_daily_stats_for com fator de rateio
-- (substitui versão da migration 030).
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
    -- Fator de rateio por pedido. Clampado em [0, 1] porque em
    -- teoria um desconto não pode exceder o valor dos produtos —
    -- se exceder, o pedido é tratado como 0 (descartável).
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
           pi.quantidade::NUMERIC                          AS quantidade,
           (pi.valor_total::NUMERIC * a.fator_ajuste)      AS valor_total
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

-- 2. Reescrever refresh_sku_hourly_stats_for com fator de rateio
-- (substitui versão da migration 032).
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
  )
  SELECT p_data, p_hora, p_ecommerce_nome,
         ps.sku, ps.sku_pai, ps.quantidade, ps.faturamento,
         pp.pedidos_count, ps.descricao, now()
  FROM por_sku ps
  JOIN por_sku_pai pp ON pp.sku_pai = ps.sku_pai;
END;
$$;

-- 3. Backfill: reprocessa histórico com a nova lógica de rateio.
-- Chama as funções existentes de reconciliação (028 e 032) — elas
-- já varrem (data, loja[, hora]) distintos e invocam o refresh
-- atualizado acima.
--
-- - Daily: 400 dias é o padrão já usado em ops (ver nota da 030).
-- - Hourly: 30 dias cobre janelas de "Hoje vs Ontem" de Alertas
--   com folga; horas mais antigas raramente são consultadas.
SELECT reconcile_sku_daily_stats(400);
SELECT reconcile_sku_hourly_stats(30);

-- ============================================================
-- DOWN (rollback):
-- Reaplicar a definição de refresh_sku_daily_stats_for da 030 e
-- de refresh_sku_hourly_stats_for da 032, e rodar reconcile_*
-- para reverter os valores dos summaries.
-- ============================================================
