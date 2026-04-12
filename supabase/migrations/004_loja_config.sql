-- ============================================================
-- naraka-bi: Tabela de configuração de lojas
-- Mapeia ecommerce_nome do Tiny para nome de exibição e marketplace
-- ============================================================

CREATE TABLE IF NOT EXISTS loja_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ecommerce_nome_tiny text NOT NULL UNIQUE,
  nome_exibicao text NOT NULL,
  marketplace text NOT NULL CHECK (marketplace IN ('mercado_livre', 'shopee', 'tiktok', 'shein')),
  tipo_ml text CHECK (tipo_ml IN ('full', 'coleta') OR tipo_ml IS NULL),
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE loja_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON loja_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_loja_config" ON loja_config FOR SELECT USING (true);
