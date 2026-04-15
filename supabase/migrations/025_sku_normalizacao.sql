-- ============================================================
-- 025_sku_normalizacao.sql
--
-- Normalização de SKU para o dashboard:
--   - sku_alias: mesmo produto chega com nomes diferentes em
--     marketplaces (ex: "7006" Shopee = "70006" ML).
--   - sku_kit: SKU representa um kit que deve ser explodido em
--     componentes unitários, dividindo o faturamento.
--
-- Aplicado APENAS na leitura (rpc_top_skus, rpc_sku_detalhes).
-- pedido_itens permanece pristino — polling/webhook intocado.
-- Quando as tabelas estão vazias, comportamento é idêntico à 021/022.
-- ============================================================

-- ============================================================
-- 1. TABELAS
-- ============================================================
CREATE TABLE IF NOT EXISTS sku_alias (
  id            SERIAL PRIMARY KEY,
  sku_original  TEXT NOT NULL,
  canal         TEXT DEFAULT NULL,
  sku_canonico  TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  observacao    TEXT DEFAULT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_alias_unique
  ON sku_alias(sku_original, COALESCE(canal, '')) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_sku_alias_original
  ON sku_alias(sku_original) WHERE ativo = true;

GRANT SELECT ON sku_alias TO anon, authenticated;
GRANT INSERT, UPDATE ON sku_alias TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE sku_alias_id_seq TO authenticated;

CREATE TABLE IF NOT EXISTS sku_kit (
  id             SERIAL PRIMARY KEY,
  sku_kit        TEXT NOT NULL,
  sku_componente TEXT NOT NULL,
  quantidade     INT  NOT NULL DEFAULT 1,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sku_kit_no_self CHECK (sku_kit != sku_componente)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_kit_unique
  ON sku_kit(sku_kit, sku_componente) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_sku_kit_lookup
  ON sku_kit(sku_kit) WHERE ativo = true;

GRANT SELECT ON sku_kit TO anon, authenticated;
GRANT INSERT, UPDATE ON sku_kit TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE sku_kit_id_seq TO authenticated;

-- ============================================================
-- 2. rpc_top_skus — refatorada com pipeline de normalização
-- Mantém EXATAMENTE as 5 colunas da versão 021.
-- ============================================================
DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_top_skus(
  p_start DATE,
  p_end   DATE,
  p_lojas TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku_pai      TEXT,
  faturamento  NUMERIC,
  pecas        NUMERIC,
  pedidos      BIGINT,
  variacoes    TEXT[]
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  itens_brutos AS (
    SELECT
      pi.pedido_id,
      pi.sku,
      pi.quantidade::NUMERIC  AS quantidade,
      pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  -- Componentes de kit (com count para divisão proporcional)
  kit_componentes AS (
    SELECT
      sk.sku_kit,
      sk.sku_componente,
      sk.quantidade,
      COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  -- Explode kits em componentes; mantém não-kits intactos
  kit_expandido AS (
    SELECT
      ib.pedido_id,
      kc.sku_componente                          AS sku_step,
      (ib.quantidade * kc.quantidade)::NUMERIC   AS quantidade,
      (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT
      ib.pedido_id, ib.sku, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    WHERE NOT EXISTS (SELECT 1 FROM kit_componentes kc WHERE kc.sku_kit = ib.sku)
  ),
  -- Aplica alias APÓS a explosão (alias pode incidir sobre componente)
  itens_normalizados AS (
    SELECT
      ke.pedido_id,
      COALESCE(sa.sku_canonico, ke.sku_step) AS sku,
      ke.quantidade,
      ke.valor_total
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo AND a.sku_original = ke.sku_step
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  ),
  com_pai AS (
    SELECT
      pedido_id,
      sku,
      quantidade,
      valor_total,
      COALESCE(substring(sku FROM '^[0-9]+'), sku) AS sku_pai
    FROM itens_normalizados
  )
  SELECT
    sku_pai,
    SUM(valor_total)::NUMERIC             AS faturamento,
    SUM(quantidade)::NUMERIC              AS pecas,
    COUNT(DISTINCT pedido_id)::BIGINT     AS pedidos,
    array_agg(DISTINCT sku ORDER BY sku)  AS variacoes
  FROM com_pai
  GROUP BY sku_pai
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_top_skus(DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- 3. rpc_sku_detalhes — mesmo pipeline
-- Mantém EXATAMENTE as 4 colunas da versão 022.
-- ============================================================
DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);

CREATE OR REPLACE FUNCTION rpc_sku_detalhes(
  p_sku_pai TEXT,
  p_start   DATE,
  p_end     DATE,
  p_lojas   TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  sku          TEXT,
  descricao    TEXT,
  quantidade   NUMERIC,
  faturamento  NUMERIC
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH aprovados AS (
    SELECT p.id
    FROM pedidos p
    WHERE p.situacao = ANY(ARRAY[1,3,4,5,6,7,9]::SMALLINT[])
      AND p.data_pedido BETWEEN p_start AND p_end
      AND (p_lojas IS NULL OR p.ecommerce_nome = ANY(p_lojas))
  ),
  itens_brutos AS (
    SELECT
      pi.pedido_id,
      pi.sku,
      pi.descricao,
      pi.quantidade::NUMERIC  AS quantidade,
      pi.valor_total::NUMERIC AS valor_total
    FROM pedido_itens pi
    WHERE pi.pedido_id IN (SELECT id FROM aprovados)
  ),
  kit_componentes AS (
    SELECT
      sk.sku_kit,
      sk.sku_componente,
      sk.quantidade,
      COUNT(*) OVER (PARTITION BY sk.sku_kit) AS n_componentes
    FROM sku_kit sk
    WHERE sk.ativo
  ),
  kit_expandido AS (
    SELECT
      ib.pedido_id,
      kc.sku_componente                          AS sku_step,
      ib.descricao,
      (ib.quantidade * kc.quantidade)::NUMERIC   AS quantidade,
      (ib.valor_total / kc.n_componentes)::NUMERIC AS valor_total
    FROM itens_brutos ib
    JOIN kit_componentes kc ON kc.sku_kit = ib.sku
    UNION ALL
    SELECT
      ib.pedido_id, ib.sku, ib.descricao, ib.quantidade, ib.valor_total
    FROM itens_brutos ib
    WHERE NOT EXISTS (SELECT 1 FROM kit_componentes kc WHERE kc.sku_kit = ib.sku)
  ),
  itens_normalizados AS (
    SELECT
      ke.pedido_id,
      COALESCE(sa.sku_canonico, ke.sku_step) AS sku,
      ke.descricao,
      ke.quantidade,
      ke.valor_total
    FROM kit_expandido ke
    LEFT JOIN LATERAL (
      SELECT a.sku_canonico
      FROM sku_alias a
      WHERE a.ativo AND a.sku_original = ke.sku_step
      ORDER BY a.canal NULLS LAST
      LIMIT 1
    ) sa ON true
  )
  SELECT
    inn.sku,
    MAX(inn.descricao)::TEXT      AS descricao,
    SUM(inn.quantidade)::NUMERIC  AS quantidade,
    SUM(inn.valor_total)::NUMERIC AS faturamento
  FROM itens_normalizados inn
  WHERE COALESCE(substring(inn.sku FROM '^[0-9]+'), inn.sku) = p_sku_pai
  GROUP BY inn.sku
  ORDER BY faturamento DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]) TO anon, authenticated;

-- ============================================================
-- 4. RPCs de listagem para a UI de configuração
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_sku_alias_list()
RETURNS TABLE (
  id           INT,
  sku_original TEXT,
  canal        TEXT,
  sku_canonico TEXT,
  ativo        BOOLEAN,
  observacao   TEXT,
  created_at   TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, sku_original, canal, sku_canonico, ativo, observacao, created_at
  FROM sku_alias
  ORDER BY created_at DESC
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_alias_list() TO anon, authenticated;

CREATE OR REPLACE FUNCTION rpc_sku_kit_list()
RETURNS TABLE (
  id             INT,
  sku_kit        TEXT,
  sku_componente TEXT,
  quantidade     INT,
  ativo          BOOLEAN,
  created_at     TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, sku_kit, sku_componente, quantidade, ativo, created_at
  FROM sku_kit
  ORDER BY sku_kit, created_at
$$;

GRANT EXECUTE ON FUNCTION rpc_sku_kit_list() TO anon, authenticated;

-- ============================================================
-- DOWN (rollback):
-- DROP FUNCTION IF EXISTS rpc_sku_alias_list();
-- DROP FUNCTION IF EXISTS rpc_sku_kit_list();
-- DROP FUNCTION IF EXISTS rpc_sku_detalhes(TEXT, DATE, DATE, TEXT[]);
-- DROP FUNCTION IF EXISTS rpc_top_skus(DATE, DATE, TEXT[]);
-- (Reaplicar 021 e 022 para restaurar versões anteriores das RPCs)
-- DROP TABLE IF EXISTS sku_kit;
-- DROP TABLE IF EXISTS sku_alias;
-- ============================================================
