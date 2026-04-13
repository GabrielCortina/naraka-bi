-- Remove DEFAULT 0 de tentativas para forçar inserção explícita
-- Isso evita registros fantasma com tentativas=0 que mascaram o problema
ALTER TABLE webhook_retry_queue ALTER COLUMN tentativas DROP DEFAULT;
ALTER TABLE webhook_retry_queue ALTER COLUMN tentativas SET NOT NULL;

-- AÇÃO MANUAL: limpar registros fantasma existentes no Supabase Dashboard:
-- DELETE FROM webhook_retry_queue
-- WHERE tentativas = 0
-- AND ultimo_erro IS NULL
-- AND processado = false;
