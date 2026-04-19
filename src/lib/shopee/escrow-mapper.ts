// Mapeia a resposta de /api/v2/payment/get_escrow_detail para uma row da
// tabela shopee_escrow. Preserva raw_json para auditoria.
// Referência de campos: shopee-payment-docs.md §1 (order_income: 120+ campos).

export interface EscrowDetailResponse {
  order_sn: string;
  buyer_user_name?: string;
  return_order_sn_list?: string[];
  order_income?: Record<string, unknown>;
  buyer_payment_info?: Record<string, unknown>;
}

export interface ShopeeEscrowRow {
  shop_id: number;
  order_sn: string;
  buyer_total_amount: number | null;
  escrow_amount: number | null;
  escrow_amount_after_adjustment: number | null;
  original_price: number | null;
  order_selling_price: number | null;
  order_discounted_price: number | null;
  seller_discount: number | null;
  shopee_discount: number | null;
  voucher_from_seller: number | null;
  voucher_from_shopee: number | null;
  coins: number | null;
  commission_fee: number | null;
  net_commission_fee: number | null;
  service_fee: number | null;
  net_service_fee: number | null;
  seller_transaction_fee: number | null;
  credit_card_transaction_fee: number | null;
  credit_card_promotion: number | null;
  payment_promotion: number | null;
  cross_border_tax: number | null;
  escrow_tax: number | null;
  withholding_tax: number | null;
  final_shipping_fee: number | null;
  actual_shipping_fee: number | null;
  estimated_shipping_fee: number | null;
  shopee_shipping_rebate: number | null;
  seller_shipping_discount: number | null;
  shipping_fee_discount_from_3pl: number | null;
  reverse_shipping_fee: number | null;
  seller_return_refund: number | null;
  seller_lost_compensation: number | null;
  seller_coin_cash_back: number | null;
  campaign_fee: number | null;
  order_ams_commission_fee: number | null;
  fbs_fee: number | null;
  pix_discount: number | null;
  total_adjustment_amount: number | null;
  cost_of_goods_sold: number | null;
  buyer_payment_method: string | null;
  raw_json: unknown;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function mapEscrowDetailToRow(
  shopId: number,
  response: EscrowDetailResponse,
  rawJson: unknown,
): ShopeeEscrowRow {
  const inc = (response.order_income ?? {}) as Record<string, unknown>;
  const pay = (response.buyer_payment_info ?? {}) as Record<string, unknown>;

  return {
    shop_id: shopId,
    order_sn: response.order_sn,

    buyer_total_amount: num(inc.buyer_total_amount),
    escrow_amount: num(inc.escrow_amount),
    escrow_amount_after_adjustment: num(inc.escrow_amount_after_adjustment),
    original_price: num(inc.original_price ?? inc.order_original_price),
    order_selling_price: num(inc.order_selling_price),
    order_discounted_price: num(inc.order_discounted_price),

    seller_discount: num(inc.seller_discount ?? inc.order_seller_discount),
    shopee_discount: num(inc.shopee_discount),
    voucher_from_seller: num(inc.voucher_from_seller),
    voucher_from_shopee: num(inc.voucher_from_shopee),
    coins: num(inc.coins),

    commission_fee: num(inc.commission_fee),
    net_commission_fee: num(inc.net_commission_fee),
    service_fee: num(inc.service_fee),
    net_service_fee: num(inc.net_service_fee),
    seller_transaction_fee: num(inc.seller_transaction_fee),
    credit_card_transaction_fee: num(inc.credit_card_transaction_fee),
    credit_card_promotion: num(inc.credit_card_promotion),
    payment_promotion: num(inc.payment_promotion),

    cross_border_tax: num(inc.cross_border_tax),
    escrow_tax: num(inc.escrow_tax),
    withholding_tax: num(inc.withholding_tax),

    final_shipping_fee: num(inc.final_shipping_fee),
    actual_shipping_fee: num(inc.actual_shipping_fee),
    estimated_shipping_fee: num(inc.estimated_shipping_fee),
    shopee_shipping_rebate: num(inc.shopee_shipping_rebate),
    seller_shipping_discount: num(inc.seller_shipping_discount),
    shipping_fee_discount_from_3pl: num(inc.shipping_fee_discount_from_3pl),
    reverse_shipping_fee: num(inc.reverse_shipping_fee),

    seller_return_refund: num(inc.seller_return_refund),
    seller_lost_compensation: num(inc.seller_lost_compensation),
    seller_coin_cash_back: num(inc.seller_coin_cash_back),
    campaign_fee: num(inc.campaign_fee),
    order_ams_commission_fee: num(inc.order_ams_commission_fee),
    fbs_fee: num(inc.fbs_fee),

    // Campos BR-locais
    pix_discount: num(inc.pix_discount),

    total_adjustment_amount: num(inc.total_adjustment_amount),
    cost_of_goods_sold: num(inc.cost_of_goods_sold),

    buyer_payment_method: str(inc.buyer_payment_method) ?? str(pay.buyer_payment_method),

    raw_json: rawJson,
  };
}
