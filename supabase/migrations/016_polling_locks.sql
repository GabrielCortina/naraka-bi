-- Locks distribuídos via tabela com UUID (funciona com PgBouncer/Supabase pooler)
-- NÃO usa pg_backend_pid() que é compartilhado entre conexões no pool
CREATE TABLE IF NOT EXISTS polling_locks (
  lock_key text PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now(),
  locked_by text NOT NULL
);

ALTER TABLE polling_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON polling_locks FOR ALL USING (true) WITH CHECK (true);

-- Tenta adquirir lock com owner_id (UUID gerado pelo caller)
-- Insere se não existe, sobrescreve se TTL expirou
-- Retorna true se o caller é o dono do lock
CREATE OR REPLACE FUNCTION try_acquire_lock(
  p_key text,
  p_owner_id text,
  p_ttl_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO polling_locks (lock_key, locked_at, locked_by)
  VALUES (p_key, now(), p_owner_id)
  ON CONFLICT (lock_key) DO UPDATE
  SET locked_at = now(), locked_by = p_owner_id
  WHERE polling_locks.locked_at < now() - (p_ttl_seconds || ' seconds')::interval
     OR polling_locks.locked_by = p_owner_id;

  RETURN EXISTS (
    SELECT 1 FROM polling_locks
    WHERE lock_key = p_key AND locked_by = p_owner_id
  );
END;
$$;

-- Libera lock somente se o caller é o dono
CREATE OR REPLACE FUNCTION release_lock(p_key text, p_owner_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM polling_locks
  WHERE lock_key = p_key AND locked_by = p_owner_id;
END;
$$;
