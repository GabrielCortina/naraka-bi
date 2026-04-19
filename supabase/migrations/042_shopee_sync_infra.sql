-- ============================================================
-- 042_shopee_sync_infra.sql
--
-- Infra de sync/worker do módulo Shopee:
--   - shopee_sync_queue: fila de pendências (fetch_escrow_detail,
--     fetch_return_detail, fetch_order_detail). Worker consome
--     e aplica backoff exponencial em caso de falha.
--   - shopee_sync_checkpoint: progresso por (shop_id, job_name).
--     Cada job de sync lê last_window_to para retomar de onde parou.
--
-- Ambas multi-loja (shop_id em todas). Sem RLS (service_role).
-- ============================================================


-- ============================================================
-- TABELA 1: shopee_sync_queue
-- Fila de ações pendentes do worker.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_sync_queue (
  id                 BIGSERIAL PRIMARY KEY,
  shop_id            BIGINT NOT NULL,
  entity_type        TEXT NOT NULL,
  entity_id          TEXT,
  action             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'PENDING',
  priority           INT NOT NULL DEFAULT 5,
  attempt_count      INT NOT NULL DEFAULT 0,
  max_attempts       INT NOT NULL DEFAULT 5,
  next_retry_at      TIMESTAMPTZ DEFAULT NOW(),
  last_error         TEXT,
  metadata           JSONB,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  completed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
  ON shopee_sync_queue (status, priority, next_retry_at)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_sync_queue_processing
  ON shopee_sync_queue (status, updated_at)
  WHERE status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_sync_queue_shop_entity
  ON shopee_sync_queue (shop_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_sync_queue_dead
  ON shopee_sync_queue (status)
  WHERE status = 'DEAD';

CREATE OR REPLACE FUNCTION update_shopee_sync_queue_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopee_sync_queue_updated_at ON shopee_sync_queue;
CREATE TRIGGER trg_shopee_sync_queue_updated_at
BEFORE UPDATE ON shopee_sync_queue
FOR EACH ROW
EXECUTE FUNCTION update_shopee_sync_queue_updated_at();

COMMENT ON TABLE shopee_sync_queue IS
  'Fila de pendências do sync Shopee. Worker em /api/shopee/sync/worker consome itens PENDING por priority+created_at. Backoff: 5min → 15min → 1h → 6h → 24h. Após max_attempts falhas: vira DEAD (aparece em alertas).';


-- ============================================================
-- TABELA 2: shopee_sync_checkpoint
-- Progresso por (shop_id, job_name). Retomada incremental.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_sync_checkpoint (
  id                    BIGSERIAL PRIMARY KEY,
  shop_id               BIGINT NOT NULL,
  job_name              TEXT NOT NULL,
  last_window_from      TIMESTAMPTZ,
  last_window_to        TIMESTAMPTZ,
  last_cursor           TEXT,
  last_success_at       TIMESTAMPTZ,
  last_error_at         TIMESTAMPTZ,
  last_error_message    TEXT,
  is_running            BOOLEAN DEFAULT false,
  run_started_at        TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (shop_id, job_name)
);

CREATE INDEX IF NOT EXISTS idx_sync_checkpoint_shop_job
  ON shopee_sync_checkpoint (shop_id, job_name);

CREATE OR REPLACE FUNCTION update_shopee_sync_checkpoint_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopee_sync_checkpoint_updated_at ON shopee_sync_checkpoint;
CREATE TRIGGER trg_shopee_sync_checkpoint_updated_at
BEFORE UPDATE ON shopee_sync_checkpoint
FOR EACH ROW
EXECUTE FUNCTION update_shopee_sync_checkpoint_updated_at();

COMMENT ON TABLE shopee_sync_checkpoint IS
  'Progresso por (shop_id, job_name) dos jobs de sync. last_window_to marca o fim da última janela buscada — próxima rodada retoma a partir daí com 5min de overlap. is_running=true é lock; auto-libera após 15min travado.';
