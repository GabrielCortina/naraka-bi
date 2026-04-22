-- ============================================================
-- 047_shopee_mapping_compensacao.sql
--
-- Adiciona o kpi_destino 'compensacao' à constraint + upsert do
-- tipo RETURN_COMPENSATION_SERVICE_ADD. Compensações são reembolsos
-- que a Shopee paga ao seller (ex: objeto perdido/danificado) —
-- tratadas como receita informativa, NÃO entram em custos.
--
-- Observação: alguns lançamentos de compensação chegam na wallet
-- com transaction_type vazio e a classificação depende da description.
-- Essa detecção por texto acontece na API (src/app/api/shopee/financeiro).
-- ============================================================

ALTER TABLE shopee_transaction_mapping DROP CONSTRAINT IF EXISTS chk_kpi_destino;
ALTER TABLE shopee_transaction_mapping ADD CONSTRAINT chk_kpi_destino CHECK (kpi_destino IN (
  'receita_escrow', 'comissao', 'taxa', 'ads', 'afiliados',
  'difal', 'devolucao', 'devolucao_frete', 'saque',
  'pedidos_negativos', 'fbs', 'outros', 'ignorar', 'compensacao'
));

INSERT INTO shopee_transaction_mapping
  (transaction_type, classificacao, kpi_destino, descricao_pt, entra_no_custo_total, duplica_com, natureza)
VALUES
  ('RETURN_COMPENSATION_SERVICE_ADD', 'informativo', 'compensacao',
   'Compensação por devolução', false, NULL, 'credito')
ON CONFLICT (transaction_type) DO UPDATE SET
  classificacao = EXCLUDED.classificacao,
  kpi_destino = EXCLUDED.kpi_destino,
  descricao_pt = EXCLUDED.descricao_pt,
  entra_no_custo_total = EXCLUDED.entra_no_custo_total,
  duplica_com = EXCLUDED.duplica_com,
  natureza = EXCLUDED.natureza,
  updated_at = NOW();
