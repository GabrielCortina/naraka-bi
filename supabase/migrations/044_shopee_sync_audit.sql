-- ============================================================
-- 044_shopee_sync_audit.sql
--
-- Tabela de auditoria por execução de job de sync Shopee.
-- Mantém histórico para diagnóstico: janela, contagens, erros,
-- duração. Escrita por startAudit/finishAudit em src/lib/shopee/audit.ts
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_sync_audit (
  id              BIGSERIAL PRIMARY KEY,
  shop_id         BIGINT NOT NULL,
  job_name        TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'running',
  window_from     TIMESTAMPTZ,
  window_to       TIMESTAMPTZ,
  pages_fetched   INT DEFAULT 0,
  rows_read       INT DEFAULT 0,
  rows_inserted   INT DEFAULT 0,
  rows_updated    INT DEFAULT 0,
  rows_enqueued   INT DEFAULT 0,
  errors_count    INT DEFAULT 0,
  error_message   TEXT,
  metadata        JSONB,
  duration_ms     INT
);

CREATE INDEX IF NOT EXISTS idx_sync_audit_shop_job
  ON shopee_sync_audit (shop_id, job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_audit_status
  ON shopee_sync_audit (status)
  WHERE status != 'success';

COMMENT ON TABLE shopee_sync_audit IS
  'Auditoria de cada execução de sync. Mantém histórico para diagnóstico.';
