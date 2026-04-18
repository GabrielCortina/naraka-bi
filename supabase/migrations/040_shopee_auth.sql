-- ============================================================
-- 040_shopee_auth.sql
--
-- Tokens OAuth da Shopee Open Platform (API v2), por loja.
-- Multi-shop: cada partner pode autorizar múltiplas lojas,
-- cada uma com seu próprio par access_token + refresh_token.
--
-- Fluxo e expirações (ref: SHOPEE_API_REFERENCE.md §2):
--   - access_token: 4h (14400s)
--   - refresh_token: 30 dias, ROTATIVO (cada refresh gera novo)
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_tokens (
  id                  SERIAL PRIMARY KEY,
  shop_id             BIGINT NOT NULL UNIQUE,
  shop_name           TEXT,
  access_token        TEXT NOT NULL,
  refresh_token       TEXT NOT NULL,
  token_expires_at    TIMESTAMPTZ NOT NULL,
  refresh_expires_at  TIMESTAMPTZ NOT NULL,
  partner_id          BIGINT NOT NULL,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopee_tokens_shop_id
  ON shopee_tokens(shop_id);

CREATE INDEX IF NOT EXISTS idx_shopee_tokens_is_active
  ON shopee_tokens(is_active)
  WHERE is_active = true;

-- Trigger para manter updated_at automaticamente
CREATE OR REPLACE FUNCTION update_shopee_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shopee_tokens_updated_at ON shopee_tokens;
CREATE TRIGGER trg_shopee_tokens_updated_at
BEFORE UPDATE ON shopee_tokens
FOR EACH ROW
EXECUTE FUNCTION update_shopee_tokens_updated_at();

-- RLS: apenas service_role acessa (tokens são sensíveis — NUNCA expor a anon)
ALTER TABLE shopee_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_shopee_tokens"
  ON shopee_tokens FOR ALL
  USING (true) WITH CHECK (true);
