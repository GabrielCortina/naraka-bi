CREATE TABLE IF NOT EXISTS webhook_retry_queue (
  id bigserial PRIMARY KEY,
  id_pedido bigint NOT NULL,
  tipo text NOT NULL,
  tentativas integer DEFAULT 0,
  ultimo_erro text,
  criado_em timestamptz DEFAULT now(),
  proxima_tentativa timestamptz DEFAULT now(),
  processado boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_webhook_retry_nao_processado
  ON webhook_retry_queue(processado, proxima_tentativa)
  WHERE processado = false;

CREATE INDEX IF NOT EXISTS idx_webhook_retry_id_pedido
  ON webhook_retry_queue(id_pedido);

ALTER TABLE webhook_retry_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_retry" ON webhook_retry_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_retry" ON webhook_retry_queue FOR SELECT USING (true);
