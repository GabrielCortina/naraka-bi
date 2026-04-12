CREATE TABLE IF NOT EXISTS polling_logs (
  id bigserial PRIMARY KEY,
  camada text NOT NULL CHECK (camada IN ('rapido', 'status', 'reconciliacao', 'webhook')),
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  duracao_ms integer,
  pedidos_processados integer DEFAULT 0,
  pedidos_erro integer DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'timeout')),
  erro_mensagem text,
  detalhes jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polling_logs_camada ON polling_logs(camada);
CREATE INDEX IF NOT EXISTS idx_polling_logs_iniciado_em ON polling_logs(iniciado_em DESC);

ALTER TABLE polling_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_logs" ON polling_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_logs" ON polling_logs FOR SELECT USING (true);
