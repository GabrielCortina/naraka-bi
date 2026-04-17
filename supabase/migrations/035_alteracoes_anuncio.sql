-- ============================================================
-- 035_alteracoes_anuncio.sql
--
-- Tabela para registrar alterações manuais em anúncios.
-- Permite correlacionar mudanças com variações de vendas.
-- ============================================================

CREATE TABLE IF NOT EXISTS alteracoes_anuncio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  data_alteracao DATE NOT NULL,
  sku TEXT NOT NULL,
  tipo_alteracao TEXT NOT NULL,
  loja TEXT,

  valor_antes TEXT,
  valor_depois TEXT,
  motivo TEXT,
  impacto_esperado TEXT,
  tags TEXT[],
  observacao TEXT,
  responsavel TEXT,

  registrado_por TEXT,
  registrado_em TIMESTAMPTZ DEFAULT now(),

  excluido_em TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_alteracoes_data ON alteracoes_anuncio(data_alteracao) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_alteracoes_sku ON alteracoes_anuncio(sku) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_alteracoes_tipo ON alteracoes_anuncio(tipo_alteracao) WHERE excluido_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_alteracoes_loja ON alteracoes_anuncio(loja) WHERE excluido_em IS NULL;

GRANT SELECT, INSERT, UPDATE ON alteracoes_anuncio TO anon, authenticated;

-- RPC: listar alterações com filtros
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
  out_loja             TEXT,
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
    a.loja,
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
    AND (p_loja        IS NULL OR a.loja = p_loja OR a.loja IS NULL)
  ORDER BY a.data_alteracao DESC, a.registrado_em DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION rpc_alteracoes_listar(DATE, DATE, TEXT, TEXT, TEXT) TO anon, authenticated;

-- RPC: alterações por SKU (uso futuro na aba Alertas)
DROP FUNCTION IF EXISTS rpc_alteracoes_por_sku(TEXT, INT);

CREATE OR REPLACE FUNCTION rpc_alteracoes_por_sku(
  p_sku        TEXT,
  p_dias_atras INT DEFAULT 30
)
RETURNS TABLE (
  out_id             UUID,
  out_data_alteracao DATE,
  out_tipo_alteracao TEXT,
  out_loja           TEXT,
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
    a.loja,
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
