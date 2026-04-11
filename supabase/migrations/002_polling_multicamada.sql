-- ============================================================
-- naraka-bi: Migração para polling em 3 camadas
-- Adiciona colunas de controle de sincronização
-- ============================================================

-- Última vez que o pedido foi sincronizado com a Tiny
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ DEFAULT NOW();

-- Flag calculada: true quando situação é estado final (não precisa mais atualizar)
-- Estados finais: 1=Faturada, 2=Cancelada, 5=Enviada, 6=Entregue, 9=Não Entregue
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS situacao_final BOOLEAN DEFAULT FALSE;

-- Atualiza pedidos existentes com base na situação atual
UPDATE pedidos SET situacao_final = (situacao IN (1, 2, 5, 6, 9));
UPDATE pedidos SET last_sync_at = updated_at WHERE last_sync_at IS NULL;

-- Índice para buscar pedidos "vivos" (não finais) rapidamente
CREATE INDEX IF NOT EXISTS idx_pedidos_situacao_final ON pedidos(situacao_final) WHERE situacao_final = FALSE;

-- Índice para last_sync_at (reconciliação)
CREATE INDEX IF NOT EXISTS idx_pedidos_last_sync_at ON pedidos(last_sync_at);
