-- ============================================================
-- 029_backfill_heatmap_stats.sql
--
-- Popula dashboard_heatmap_stats com o histórico completo.
-- Rodar UMA VEZ após aplicar 029_dashboard_heatmap_stats.sql.
--
-- Tempo estimado: 1–5 minutos para ~65k pedidos.
-- A partir do backfill, os triggers mantêm o summary atualizado.
-- Idempotente: basta rodar de novo se for interrompido.
-- ============================================================

-- Opção A — via reconciliação (recomendada; processa por par data/loja):
-- 400 = ~13 meses de histórico. Ajuste se tiver mais.
SELECT COUNT(*) AS pares_processados
FROM reconcile_heatmap_stats(400);

-- ============================================================
-- Opção B — bulk INSERT direto (mais rápido, se a opção A demorar)
-- Comentada por padrão. Descomentar APENAS se A for lenta demais.
-- ============================================================
-- TRUNCATE dashboard_heatmap_stats;
--
-- INSERT INTO dashboard_heatmap_stats (
--   data_pedido, ecommerce_nome, dia_semana, hora,
--   total_pedidos, total_faturamento, updated_at
-- )
-- SELECT
--   p.data_pedido,
--   p.ecommerce_nome,
--   EXTRACT(DOW  FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
--   EXTRACT(HOUR FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
--   COUNT(*)::BIGINT,
--   COALESCE(SUM(p.valor_total_pedido), 0)::NUMERIC,
--   now()
-- FROM pedidos p
-- WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
--   AND p.ecommerce_nome IS NOT NULL
--   AND p.last_sync_at IS NOT NULL
-- GROUP BY
--   p.data_pedido,
--   p.ecommerce_nome,
--   EXTRACT(DOW  FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT,
--   EXTRACT(HOUR FROM (p.last_sync_at AT TIME ZONE 'America/Sao_Paulo'))::INT;

-- ============================================================
-- VALIDAÇÃO pós-backfill:
-- ============================================================
-- 1. Contagem e cobertura temporal:
-- SELECT COUNT(*) AS linhas,
--        MIN(data_pedido) AS primeira_data,
--        MAX(data_pedido) AS ultima_data,
--        COUNT(DISTINCT ecommerce_nome) AS lojas
-- FROM dashboard_heatmap_stats;

-- 2. rpc_heatmap deve retornar resultados e ser rápida:
-- EXPLAIN ANALYZE
-- SELECT * FROM rpc_heatmap(CURRENT_DATE - 7, CURRENT_DATE, NULL);
-- Esperado: <100ms, até 168 linhas (7 dias × 24 horas máx).

-- 3. Comparar totais com o summary daily (sanidade):
-- SELECT
--   (SELECT SUM(contagem) FROM rpc_heatmap(CURRENT_DATE - 7, CURRENT_DATE, NULL)) AS heatmap_pedidos,
--   (SELECT SUM(pedidos)  FROM dashboard_daily_stats
--      WHERE data_pedido BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE) AS daily_pedidos;
-- heatmap_pedidos pode ser ≤ daily_pedidos: heatmap exclui last_sync_at NULL.
