CREATE TABLE IF NOT EXISTS reconciliacao_relatorio (
  id bigserial PRIMARY KEY,
  iniciada_em timestamptz NOT NULL,
  finalizada_em timestamptz,
  status text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'concluida', 'interrompida')),
  pedidos_varridos integer DEFAULT 0,
  pedidos_divergentes integer DEFAULT 0,
  pedidos_corrigidos integer DEFAULT 0,
  pedidos_faltaram integer DEFAULT 0,
  dias_processados integer DEFAULT 0,
  dias_total integer DEFAULT 3,
  ultimo_checkpoint_data date,
  ultimo_checkpoint_offset integer DEFAULT 0,
  observacao text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reconciliacao_relatorio ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_relatorio" ON reconciliacao_relatorio FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_relatorio" ON reconciliacao_relatorio FOR SELECT USING (true);
