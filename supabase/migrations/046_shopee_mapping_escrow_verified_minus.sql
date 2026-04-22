-- ============================================================
-- 046_shopee_mapping_escrow_verified_minus.sql
--
-- ESCROW_VERIFIED_MINUS (pedidos negativos) deixa de ser custo
-- porque o custo real já está em shopee_escrow.reverse_shipping_fee
-- e shopee_escrow.actual_shipping_fee quando shopee_shipping_rebate=0.
-- Manter entra_no_custo_total=true causaria double counting no
-- dashboard financeiro.
-- ============================================================

UPDATE shopee_transaction_mapping
SET entra_no_custo_total = false
WHERE transaction_type = 'ESCROW_VERIFIED_MINUS';
