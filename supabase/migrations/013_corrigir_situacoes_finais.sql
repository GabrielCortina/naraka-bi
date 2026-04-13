-- Corrigir pedidos marcados como final incorretamente pela migration 002
-- Situacoes 1 (Faturada) e 5 (Enviada) NAO sao finais
UPDATE pedidos
SET situacao_final = false
WHERE situacao IN (1, 5)
AND situacao_final = true;

-- Garantir que situacoes realmente finais estao marcadas corretamente
-- SITUACOES_FINAIS = [2, 6, 9] (Cancelada, Entregue, Nao Entregue)
UPDATE pedidos
SET situacao_final = true
WHERE situacao IN (2, 6, 9)
AND situacao_final = false;
