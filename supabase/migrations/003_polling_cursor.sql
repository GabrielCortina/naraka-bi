-- ============================================================
-- naraka-bi: Migração para cursor-based polling
-- Adiciona cursor_id e cursor_data ao polling_state
-- ============================================================

-- Último id_tiny processado pelo polling rápido
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS cursor_id BIGINT DEFAULT 0;

-- Data do cursor atual (reseta à meia-noite)
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS cursor_data DATE DEFAULT CURRENT_DATE;
