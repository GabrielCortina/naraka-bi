ALTER TABLE pedidos
ADD COLUMN IF NOT EXISTS itens_sync_error boolean DEFAULT false;
