ALTER TABLE polling_logs DROP CONSTRAINT IF EXISTS polling_logs_camada_check;
ALTER TABLE polling_logs ADD CONSTRAINT polling_logs_camada_check
  CHECK (camada IN ('rapido', 'status', 'reconciliacao', 'webhook', 'retry'));
