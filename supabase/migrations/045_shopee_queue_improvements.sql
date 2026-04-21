-- ============================================================
-- 045_shopee_queue_improvements.sql
--
-- Preparação da fila shopee_sync_queue para a Etapa 2:
--   - Colunas: locked_at, locked_by, dead_reason, dedupe_key
--     (max_attempts já existe na 042 — ALTER é no-op via IF NOT EXISTS)
--   - Índices para SKIP LOCKED e dedupe
--   - Funções claim_sync_tasks / recover_stuck_tasks
--
-- Todas as adições são aditivas: código antigo da fila continua
-- funcionando sem alteração.
-- ============================================================

ALTER TABLE shopee_sync_queue
  ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by     TEXT,
  ADD COLUMN IF NOT EXISTS max_attempts  INT DEFAULT 10,
  ADD COLUMN IF NOT EXISTS dead_reason   TEXT,
  ADD COLUMN IF NOT EXISTS dedupe_key    TEXT;

-- Índice para SKIP LOCKED (preparação Etapa 2).
CREATE INDEX IF NOT EXISTS idx_queue_pending_priority
  ON shopee_sync_queue (priority DESC, created_at ASC)
  WHERE status = 'PENDING';

-- Índice para dedupe. NÃO é UNIQUE porque registros existentes
-- ainda não têm dedupe_key; promover a UNIQUE só após backfill.
CREATE INDEX IF NOT EXISTS idx_queue_dedupe
  ON shopee_sync_queue (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('PENDING', 'PROCESSING');

-- Função de claim com SKIP LOCKED (consumida pela Etapa 2).
CREATE OR REPLACE FUNCTION claim_sync_tasks(
  p_batch_size         INT DEFAULT 15,
  p_worker_id          TEXT DEFAULT 'worker-1',
  p_visibility_timeout INTERVAL DEFAULT '5 minutes'
) RETURNS SETOF shopee_sync_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE shopee_sync_queue
  SET status = 'PROCESSING',
      locked_at = NOW(),
      locked_by = p_worker_id,
      updated_at = NOW()
  WHERE id IN (
    SELECT id FROM shopee_sync_queue
    WHERE status = 'PENDING'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_batch_size
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- Recupera tasks travadas em PROCESSING além do visibility timeout.
CREATE OR REPLACE FUNCTION recover_stuck_tasks(
  p_timeout INTERVAL DEFAULT '10 minutes'
) RETURNS INT AS $$
DECLARE
  recovered INT;
BEGIN
  UPDATE shopee_sync_queue
  SET status = 'PENDING',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = NOW()
  WHERE status = 'PROCESSING'
  AND locked_at IS NOT NULL
  AND locked_at < NOW() - p_timeout;

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN shopee_sync_queue.dedupe_key IS
  'Chave para evitar tasks duplicadas. Ex: fetch_escrow_detail:869193731:260409AYV9SAMK';
