-- ============================================================
-- 036_alteracoes_anuncio_lojas.sql
--
-- Substitui coluna `loja` (TEXT) por `lojas` (TEXT[]) em
-- alteracoes_anuncio, permitindo registrar a alteração em
-- múltiplas lojas simultaneamente.
--
-- Convenção: lojas NULL ou array vazio => aplica-se a TODAS as lojas.
-- A coluna `loja` é mantida (legada) por segurança.
-- ============================================================

ALTER TABLE alteracoes_anuncio
  ADD COLUMN IF NOT EXISTS lojas TEXT[];

-- Migrar dados existentes: string escalar -> array de um elemento.
UPDATE alteracoes_anuncio
SET lojas = CASE
  WHEN loja IS NULL THEN NULL
  ELSE ARRAY[loja]
END
WHERE lojas IS NULL;

-- Índice GIN para filtros por ANY/contém
CREATE INDEX IF NOT EXISTS idx_alteracoes_lojas
  ON alteracoes_anuncio USING GIN (lojas)
  WHERE excluido_em IS NULL;

-- ============================================================
-- RPC: listar — filtra lojas via ANY()
-- Semântica do filtro p_loja:
--   NULL              -> sem filtro
--   'ELIS MELI'       -> retorna onde p_loja = ANY(lojas)
--                        OU lojas IS NULL OU cardinality(lojas) = 0
--                        (alterações "todas as lojas" sempre aparecem)
-- ============================================================
DROP FUNCTION IF EXISTS rpc_alteracoes_listar(DATE, DATE, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION rpc_alteracoes_listar(
  p_data_inicio DATE DEFAULT NULL,
  p_data_fim    DATE DEFAULT NULL,
  p_sku         TEXT DEFAULT NULL,
  p_tipo        TEXT DEFAULT NULL,
  p_loja        TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_id               UUID,
  out_data_alteracao   DATE,
  out_sku              TEXT,
  out_tipo_alteracao   TEXT,
  out_lojas            TEXT[],
  out_valor_antes      TEXT,
  out_valor_depois     TEXT,
  out_motivo           TEXT,
  out_impacto_esperado TEXT,
  out_tags             TEXT[],
  out_observacao       TEXT,
  out_responsavel      TEXT,
  out_registrado_em    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.data_alteracao,
    a.sku,
    a.tipo_alteracao,
    a.lojas,
    a.valor_antes,
    a.valor_depois,
    a.motivo,
    a.impacto_esperado,
    a.tags,
    a.observacao,
    a.responsavel,
    a.registrado_em
  FROM alteracoes_anuncio a
  WHERE a.excluido_em IS NULL
    AND (p_data_inicio IS NULL OR a.data_alteracao >= p_data_inicio)
    AND (p_data_fim    IS NULL OR a.data_alteracao <= p_data_fim)
    AND (p_sku         IS NULL OR a.sku ILIKE '%' || p_sku || '%')
    AND (p_tipo        IS NULL OR a.tipo_alteracao = p_tipo)
    AND (
      p_loja IS NULL
      OR a.lojas IS NULL
      OR coalesce(cardinality(a.lojas), 0) = 0
      OR p_loja = ANY(a.lojas)
    )
  ORDER BY a.data_alteracao DESC, a.registrado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alteracoes_listar(DATE, DATE, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============================================================
-- RPC por SKU — retorna array de lojas
-- ============================================================
DROP FUNCTION IF EXISTS rpc_alteracoes_por_sku(TEXT, INT);

CREATE OR REPLACE FUNCTION rpc_alteracoes_por_sku(
  p_sku        TEXT,
  p_dias_atras INT DEFAULT 30
)
RETURNS TABLE (
  out_id             UUID,
  out_data_alteracao DATE,
  out_tipo_alteracao TEXT,
  out_lojas          TEXT[],
  out_valor_antes    TEXT,
  out_valor_depois   TEXT,
  out_motivo         TEXT,
  out_observacao     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.data_alteracao,
    a.tipo_alteracao,
    a.lojas,
    a.valor_antes,
    a.valor_depois,
    a.motivo,
    a.observacao
  FROM alteracoes_anuncio a
  WHERE a.excluido_em IS NULL
    AND (a.sku = p_sku OR a.sku = split_part(p_sku, '-', 1))
    AND a.data_alteracao >= CURRENT_DATE - p_dias_atras
  ORDER BY a.data_alteracao DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alteracoes_por_sku(TEXT, INT) TO anon, authenticated;
