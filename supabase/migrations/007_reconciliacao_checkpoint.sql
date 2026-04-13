-- Checkpoint da reconciliação para processamento paginado em 2 fases
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_data date;
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_offset integer DEFAULT 0;
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_concluida_em timestamptz;
ALTER TABLE polling_state ADD COLUMN IF NOT EXISTS reconciliacao_iniciada_em timestamptz;
