-- Adiciona coluna nome_loja para agrupar lojas do mesmo dono
-- Ex: "NARAKA - ML FULL" e "NARAKA - ML Coleta" ambos teriam nome_loja = "NARAKA"
ALTER TABLE loja_config ADD COLUMN IF NOT EXISTS nome_loja text;
