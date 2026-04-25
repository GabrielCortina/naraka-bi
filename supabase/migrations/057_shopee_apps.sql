-- ============================================================
-- 057_shopee_apps.sql
--
-- Multi-app Shopee Open Platform.
-- Cada partner_id é um "app" registrado no Partner Portal — guardamos
-- as credenciais (partner_key) por linha aqui e cruzamos com
-- shopee_tokens.partner_id para descobrir qual key assinar quando
-- batemos numa loja.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopee_apps (
  partner_id    BIGINT PRIMARY KEY,
  partner_key   TEXT NOT NULL,
  redirect_url  TEXT NOT NULL DEFAULT 'https://naraka-bi.vercel.app/api/auth/shopee/callback',
  is_production BOOLEAN DEFAULT true,
  label         TEXT NOT NULL,
  ativo         BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_apps_label_lower
  ON shopee_apps (lower(label))
  WHERE ativo = true;

-- Seed dos dois apps existentes (Oxean já está em produção; Joy é o novo).
INSERT INTO shopee_apps (partner_id, partner_key, redirect_url, is_production, label) VALUES
  (2033268, 'shpk46496143475a50584c626d546942564877646a456370704369504276634b',
           'https://naraka-bi.vercel.app/api/auth/shopee/callback', true, 'Oxean'),
  (2033526, 'shpk7a44756c506d4c70704d737941477567687a766a7168625054574e7a4a68',
           'https://naraka-bi.vercel.app/api/auth/shopee/callback', true, 'Joy')
ON CONFLICT (partner_id) DO NOTHING;

-- RLS: leitura ok para anon/auth (não há segredos sensíveis fora do partner_key,
-- mas só service_role faz signing — leitura aqui é só pra UI/admin).
ALTER TABLE shopee_apps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_shopee_apps"
  ON shopee_apps FOR ALL
  USING (true) WITH CHECK (true);

GRANT SELECT ON shopee_apps TO anon, authenticated;

COMMENT ON TABLE shopee_apps IS
  'Apps Shopee registrados (partner_id + partner_key). Cruzar com shopee_tokens.partner_id para escolher key de signing.';
