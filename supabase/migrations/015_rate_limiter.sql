CREATE TABLE IF NOT EXISTS rate_limiter (
  id text PRIMARY KEY,
  requisicoes_no_minuto integer DEFAULT 0,
  janela_inicio timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO rate_limiter (id, requisicoes_no_minuto, janela_inicio)
VALUES ('tiny_api', 0, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE rate_limiter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON rate_limiter FOR ALL USING (true) WITH CHECK (true);

-- Incremento atômico: reseta janela se expirou, incrementa e retorna
-- Retorna requisicoes_no_minuto APÓS incremento
-- Evita race condition read-modify-write
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_id text,
  p_limite integer,
  p_janela_ms integer DEFAULT 60000
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_janela_inicio timestamptz;
  v_agora timestamptz := now();
BEGIN
  SELECT requisicoes_no_minuto, janela_inicio
  INTO v_count, v_janela_inicio
  FROM rate_limiter
  WHERE id = p_id
  FOR UPDATE; -- lock a row para atomicidade

  IF NOT FOUND THEN
    INSERT INTO rate_limiter (id, requisicoes_no_minuto, janela_inicio, updated_at)
    VALUES (p_id, 1, v_agora, v_agora);
    RETURN 1;
  END IF;

  -- Se a janela expirou, reseta
  IF extract(epoch from (v_agora - v_janela_inicio)) * 1000 >= p_janela_ms THEN
    UPDATE rate_limiter
    SET requisicoes_no_minuto = 1, janela_inicio = v_agora, updated_at = v_agora
    WHERE id = p_id;
    RETURN 1;
  END IF;

  -- Incrementa
  v_count := v_count + 1;
  UPDATE rate_limiter
  SET requisicoes_no_minuto = v_count, updated_at = v_agora
  WHERE id = p_id;

  RETURN v_count;
END;
$$;
