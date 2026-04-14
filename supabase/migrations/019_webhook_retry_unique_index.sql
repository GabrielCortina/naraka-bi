-- Remove duplicatas existentes mantendo o mais recente
DELETE FROM webhook_retry_queue a
USING webhook_retry_queue b
WHERE a.id < b.id
AND a.id_pedido = b.id_pedido
AND a.processado = false
AND b.processado = false;

-- Unique partial index: apenas 1 entrada não processada por pedido
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_retry_unique_pedido_ativo
ON webhook_retry_queue(id_pedido)
WHERE processado = false;
