CREATE TABLE IF NOT EXISTS reconciliacao_divergentes (
  id bigserial PRIMARY KEY,
  id_pedido bigint NOT NULL UNIQUE,
  criado_em timestamptz DEFAULT now(),
  processado boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_reconciliacao_divergentes_nao_processado
  ON reconciliacao_divergentes(processado) WHERE processado = false;

ALTER TABLE reconciliacao_divergentes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON reconciliacao_divergentes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read" ON reconciliacao_divergentes FOR SELECT USING (true);
