-- Checkpoint para reconciliação paginada
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_data date;
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_offset integer DEFAULT 0;
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_concluida_em timestamptz;
