# Shopee Open Platform — Documentação dos Endpoints Financeiros e Pedido

Fonte: documentação oficial da Shopee Open Platform v2 (https://open.shopee.com/documents/v2/).
Dados extraídos diretamente da API interna de docs (`/opservice/api/v1/doc/api/`).

## Observações gerais

Base URLs (já estabelecidas):
- Produção (BR — para chamadas de API): `https://openplatform.shopee.com.br`
- Produção (SEA / default): `https://partner.shopeemobile.com`
- Sandbox (auth + API): `https://openplatform.sandbox.test-stable.shopee.sg`

Todos os endpoints aqui são **Shop APIs**: exigem Common Params `partner_id`, `timestamp`, `access_token`, `shop_id` e `sign`. O `sign` é HMAC-SHA256 sobre `partner_id + api_path + timestamp + access_token + shop_id` com `partner_key` como chave.

Método: na API interna, `method: 2 / is_get_method: 0` = **GET** (com params na query string); `method: 1` = **POST**. Como notação, todos os endpoints abaixo que têm `is_get_method: 0` são chamados via `GET` com os parâmetros na query string + body JSON (exceto batch que usa POST com body).

---

## 1. `v2.payment.get_escrow_detail`

**Módulo:** Payment
**Método HTTP:** GET
**Path:** `/api/v2/payment/get_escrow_detail`
**URL Prod (BR):** `https://openplatform.shopee.com.br/api/v2/payment/get_escrow_detail`
**URL Prod (SEA):** `https://partner.shopeemobile.com/api/v2/payment/get_escrow_detail`
**URL Sandbox:** `https://partner.test-stable.shopeemobile.com/api/v2/payment/get_escrow_detail`
**Descrição:** Use this API to fetch the accounting detail of order.
**Permissões:** ERP System, Seller In House System, Accounting And Finance, Customer Service, Brand Membership, Swam ERP

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `order_sn` | string | **True** | `220914R9U7D3C6` | Shopee's unique identifier for an order. |

### Response Parameters (lista completa — 178 campos)

Top-level:

| Nome | Tipo | Descrição |
|------|------|-----------|
| `request_id` | string | Identifier for an API request for error tracking. |
| `error` | string | Error type if hit error. Empty if no error happened. |
| `message` | string | Error details if hit error. |
| `response` | object | Business content. |
| `response.order_sn` | string | Order serial number. |
| `response.buyer_user_name` | string | Buyer username. |
| `response.return_order_sn_list` | string[] | List of return order serials. |
| `response.order_income` | object | Full order income breakdown. |
| `response.buyer_payment_info` | object | Payment info paid by buyer. |

**`response.order_income` (campos financeiros — foco principal):**

| Campo | Tipo |
|-------|------|
| `escrow_amount` | float |
| `buyer_total_amount` | float |
| `order_original_price` | float |
| `original_price` | float |
| `order_discounted_price` | float |
| `order_selling_price` | float |
| `order_seller_discount` | float |
| `bcrs_deposit` | float |
| `seller_discount` | float |
| `shopee_discount` | float |
| `voucher_from_seller` | float |
| `voucher_from_shopee` | float |
| `coins` | float |
| `buyer_paid_shipping_fee` | float |
| `buyer_transaction_fee` | float |
| `cross_border_tax` | float |
| `payment_promotion` | float |
| `commission_fee` | float |
| `service_fee` | float |
| `seller_transaction_fee` | float |
| `seller_lost_compensation` | float |
| `seller_coin_cash_back` | float |
| `escrow_tax` | float |
| `estimated_shipping_fee` | float |
| `final_shipping_fee` | float |
| `actual_shipping_fee` | float |
| `shipping_fee_sst` | float |
| `order_chargeable_weight` | int32 |
| `shopee_shipping_rebate` | float |
| `shipping_fee_discount_from_3pl` | float |
| `seller_shipping_discount` | float |
| `seller_voucher_code` | string[] |
| `drc_adjustable_refund` | float |
| `cost_of_goods_sold` | float |
| `original_cost_of_goods_sold` | float |
| `original_shopee_discount` | float |
| `seller_return_refund` | float |
| `escrow_amount_pri` | float |
| `buyer_total_amount_pri` | float |
| `original_price_pri` | float |
| `seller_return_refund_pri` | float |
| `commission_fee_pri` | float |
| `service_fee_pri` | float |
| `drc_adjustable_refund_pri` | float |
| `pri_currency` | string |
| `aff_currency` | string |
| `exchange_rate` | float |
| `reverse_shipping_fee` | float |
| `reverse_shipping_fee_sst` | float |
| `final_product_protection` | float |
| `credit_card_promotion` | float |
| `credit_card_transaction_fee` | float |
| `final_product_vat_tax` | float |
| `final_shipping_vat_tax` | float |
| `campaign_fee` | float |
| `sip_subsidy` | float |
| `sip_subsidy_pri` | float |
| `rsf_seller_protection_fee_claim_amount` | float |
| `shipping_seller_protection_fee_amount` | float |
| `final_escrow_product_gst` | float |
| `final_escrow_shipping_gst` | float |
| `delivery_seller_protection_fee_premium_amount` | float |
| `total_adjustment_amount` | float |
| `escrow_amount_after_adjustment` | float |
| `order_ams_commission_fee` | float |
| `buyer_payment_method` | string |
| `instalment_plan` | string |
| `sales_tax_on_lvg` | float |
| `final_return_to_seller_shipping_fee` | float |
| `withholding_tax` | float |
| `overseas_return_service_fee` | float |
| `prorated_coins_value_offset_return_items` | float |
| `prorated_shopee_voucher_offset_return_items` | float |
| `prorated_seller_voucher_offset_return_items` | float |
| `prorated_payment_channel_promo_bank_offset_return_items` | float |
| `prorated_payment_channel_promo_shopee_offset_return_items` | float |
| `fsf_seller_protection_fee_claim_amount` | float |
| `vat_on_imported_goods` | float |
| `withholding_vat_tax` | float |
| `withholding_pit_tax` | float |
| `tax_registration_code` | string |
| `seller_order_processing_fee` | float |
| `buyer_paid_packaging_fee` | float |
| `trade_in_bonus_by_seller` | float |
| `fbs_fee` | float |
| **`net_commission_fee`** | float |
| **`net_service_fee`** | float |
| **`net_commission_fee_info_list`** | object[] → `rule_id`, `fee_amount`, `rule_display_name` |
| **`net_service_fee_info_list`** | object[] → `rule_id`, `fee_amount`, `rule_display_name`, `category` |
| **`seller_product_rebate`** | object → `amount`, `commission_fee_offset`, `service_fee_offset` |
| **`pix_discount`** | float (BR) |
| **`prorated_pix_discount_offset_return_items`** | float (BR) |
| **`ads_escrow_top_up_fee_or_technical_support_fee`** | float |
| **`th_import_duty`** | float |

**`response.order_income.items[]`:**
`item_id`, `item_name`, `item_sku`, `model_id`, `model_name`, `model_sku`, `original_price`, `original_price_pri`, `selling_price`, `discounted_price`, `bcrs_deposit`, `seller_discount`, `shopee_discount`, `discount_from_coin`, `discount_from_voucher_shopee`, `discount_from_voucher_seller`, `activity_type`, `activity_id`, `is_main_item`, `quantity_purchased`, `is_b2c_shop_item`, `ams_commission_fee`, `is_kit`, `kit_items` (object), `promotion_list[]`.

**`response.order_income.order_adjustment[]`:** `amount`, `date`, `currency`, `adjustment_reason`

**`response.order_income.tenure_info_list`:** `payment_channel_name`, `instalment_plan`

**`response.buyer_payment_info`:** `buyer_payment_method`, `buyer_service_fee`, `buyer_tax_amount`, `buyer_total_amount`, `shopeevip_subtotal`, `credit_card_promotion`, `icms_tax_amount`, `import_tax_amount`, `initial_buyer_txn_fee`, `insurance_premium`, `iof_tax_amount`, `is_paid_by_credit_card`, `merchant_subtotal`, `seller_voucher`, `shipping_fee`, `shipping_fee_sst_amount`, `shopee_voucher`, `shopee_coins_redeemed`, `buyer_paid_packaging_fee`, `trade_in_bonus`, `bulky_handling_fee`, `discount_pix`, `bcrs_deposit`.

### Response Example (excerto)

```json
{
  "error": "",
  "message": "",
  "request_id": "b3adb9c441e3b32f6a46286390ef4b00",
  "response": {
    "order_sn": "220725D58X...",
    "buyer_user_name": "...",
    "buyer_payment_info": {
      "bulky_handling_fee": 0,
      "buyer_payment_method": "Credit Card/Debit Card",
      "buyer_service_fee": 0,
      "buyer_tax_amount": 0,
      "buyer_total_amount": 7.07,
      "credit_card_promotion": 0,
      "is_paid_by_credit_card": true,
      "merchant_subtotal": 7.98,
      "seller_voucher": 0,
      "shipping_fee": 0,
      "shopee_coins_redeemed": 0
    },
    "order_income": {
      "escrow_amount": 3.45,
      "buyer_total_amount": 7.07,
      "commission_fee": 0.57,
      "service_fee": 0.88,
      "net_commission_fee": 0.57,
      "net_service_fee": 0.88
    }
  }
}
```

### Error Codes (25)

`error_param` (no access_token/partner_id/sign/timestamp, invalid params, missing order_sn, invalid promotion ID, invalid page_size, not from gateway, body not valid json), `error_auth` (invalid access_token, no permission), `error_sign` (wrong sign), `error_network`, `error_data` (parse data failed, data not exist), `error_server` (internal server, something wrong), `error_shop` (shopid invalid), `order_not_found` (order SN invalid), `common.error_not_found` (supplier order item income not found).

### Update Log

- **2026-04-10**: add new response field `shopeevip_subtotal` under `buyer_payment_info`.
- **2026-03-27**: add response new fields `bcrs_deposit` under `order_income`, `order_income.items`, `buyer_payment_info`.
- **2026-03-06**: updated with `th_import_duty`.
- **2026-02-09**: `order_income` added `pix_discount` and `prorated_pix_discount_offset_return_items`; updated with `ads_escrow_top_up_fee_or_technical_support_fee`.
- **2025-12-26**: add new response fields `net_commission_fee`, `net_service_fee`, `net_commission_fee_info_list`, `net_service_fee_info_list`, `seller_product_rebate` — **only for BR local sellers**.

---

## 2. `v2.payment.get_escrow_list`

**Método HTTP:** GET
**Path:** `/api/v2/payment/get_escrow_list`
**Descrição:** Use this API to fetch the accounting list of order.
**Permissões:** ERP System, Seller In House System, Accounting And Finance, Swam ERP

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `release_time_from` | timestamp | **True** | `1651680000` | Query start time (Unix seconds). |
| `release_time_to` | timestamp | **True** | `1651939200` | Query end time. |
| `page_size` | int32 | False | `40` | Number of records per page. Max 100, default 40. |
| `page_no` | int32 | False | `1` | Page number. Min 1, default 1. |

### Response Parameters

| Nome | Tipo | Descrição |
|------|------|-----------|
| `error` | string | Error type if any. |
| `message` | string | Error detail. |
| `request_id` | string | Request identifier. |
| `response` | object | Business content. |
| `response.escrow_list` | object[] | List of escrow orders. |
| `response.escrow_list[].order_sn` | string | Order serial. |
| `response.escrow_list[].payout_amount` | float | Settlement amount. |
| `response.escrow_list[].escrow_release_time` | timestamp | Release time. |
| `response.more` | boolean | True if there are more pages. |

### Response Example

```json
{
  "request_id": "8d7de8c04b4cd5f3df9e4aa98c2d87d1",
  "error": "",
  "message": "",
  "response": {
    "more": true,
    "escrow_list": [
      {"order_sn": "220415N6SB140P", "payout_amount": 57334, "escrow_release_time": 1651849648},
      {"order_sn": "220415M9J6GHBP", "payout_amount": 5930,  "escrow_release_time": 1651849648},
      {"order_sn": "220415K6R91FDM", "payout_amount": 5241,  "escrow_release_time": 1651849648}
    ]
  }
}
```

### Error Codes (principais)

`error_param` (shop_id required, date range invalid, page_size invalid), `error_auth`, `error_sign`, `error_shop` (shopid invalid), `order_not_found`, `income_not_found`, `income_error_server`, `decoded_failed_error`, `internal_error_server`, `get_item_error_server`, `return_info_error_server`, `shopid_invalid`, `userid_invalid`.

### Update Log
- **2025-09-08**: select type for some parameters.

---

## 3. `v2.payment.get_wallet_transaction_list`

**Método HTTP:** GET
**Path:** `/api/v2/payment/get_wallet_transaction_list`
**Descrição:** Use this API to get the transaction records of wallet. **Only applicable for local shops.**
**Permissões:** ERP System, Seller In House System, Accounting And Finance, Swam ERP

### Request Parameters

| Nome | Tipo | Required | Descrição |
|------|------|----------|-----------|
| `page_no` | int | **True** | Starting entry of data. Default 0. |
| `page_size` | int | **True** | Records per page. Default 40. |
| `create_time_from` | int | False | Start of date range (Unix). Max 15 days range. |
| `create_time_to` | int | False | End of date range. |
| `wallet_type` | string | False | Wallet type. |
| `transaction_type` | string | False | Filter by transaction type (see enum abaixo). |
| `money_flow` | string | False | `MONEY_IN` = addition / `MONEY_OUT` = deduction. Unspecified = all. TW JKO ignores money_flow. |
| `transaction_tab_type` | string | False | Apenas 1 valor. Múltiplos valores fazem o filtro ser ignorado. |

### Enum — `transaction_type` (códigos)

| Code | Name | Descrição |
|------|------|-----------|
| 101 | `ESCROW_VERIFIED_ADD` | Escrow verificado e pago ao vendedor. |
| 102 | `ESCROW_VERIFIED_MINUS` | Escrow verificado e cobrado do vendedor (escrow negativo). |
| 201 | `WITHDRAWAL_CREATED` | Saque criado (deduzido do saldo). |
| 202 | `WITHDRAWAL_COMPLETED` | Saque concluído (ongoing diminui). |
| 203 | `WITHDRAWAL_CANCELLED` | Saque cancelado (adiciona de volta ao saldo). |
| 401 | `ADJUSTMENT_ADD` | Ajuste positivo (pago ao vendedor). |
| 402 | `ADJUSTMENT_MINUS` | Ajuste negativo (cobrado). |
| 404 | `FBS_ADJUSTMENT_ADD` | Ajuste FBS positivo. |
| 405 | `FBS_ADJUSTMENT_MINUS` | Ajuste FBS negativo. |
| 406 | `ADJUSTMENT_CENTER_ADD` | Ajuste do Adjustment Center positivo. |
| 407 | `ADJUSTMENT_CENTER_DEDUCT` | Ajuste do Adjustment Center negativo. |
| 408 | `FSF_COST_PASSING_DEDUCT` | FSF cost passing para orders cancelados/inválidos. |
| 409 | `PERCEPTION_VAT_TAX_DEDUCT` | Charge extra do regime de VAT perception (Argentina). |
| 410 | `PERCEPTION_TURNOVER_TAX_DEDUCT` | Charge extra do regime de turnover perception. |
| 450 | `PAID_ADS` | Paid ads cobrado do vendedor. |
| 451 | `PAID_ADS_REFUND` | Paid ads devolvido. |
| 452 | `FAST_ESCROW_DISBURSE` | Primeiro desembolso de fast escrow. |
| 455 | `AFFILIATE_ADS_SELLER_FEE` | Affiliate ads fee cobrada. |
| 456 | `AFFILIATE_ADS_SELLER_FEE_REFUND` | Affiliate ads fee devolvida. |
| 458 | `FAST_ESCROW_DEDUCT` | Fast escrow deduzido (return/refund). |
| 459 | `FAST_ESCROW_DISBURSE_REMAIN` | Segundo desembolso do fast escrow. |
| 460 | `AFFILIATE_FEE_DEDUCT` | Affiliate fee para serviço de MKT. |

### Response Parameters

| Nome | Tipo |
|------|------|
| `response` | object |
| `response.more` | boolean |
| `response.transaction_list` | object[] |
| `response.transaction_list[].status` | string (FAILED, COMPLETED, PENDING, INITIAL) |
| `response.transaction_list[].transaction_type` | string |
| `response.transaction_list[].amount` | float |
| `response.transaction_list[].current_balance` | float |
| `response.transaction_list[].create_time` | int |
| `response.transaction_list[].order_sn` | string |
| `response.transaction_list[].refund_sn` | string |
| `response.transaction_list[].withdrawal_type` | string |
| `response.transaction_list[].transaction_fee` | float |
| `response.transaction_list[].description` | string |
| `response.transaction_list[].buyer_name` | string |
| `response.transaction_list[].pay_order_list` | object[] |
| `response.transaction_list[].pay_order_list[].order_sn` | string |
| `response.transaction_list[].pay_order_list[].shop_name` | string |
| `response.transaction_list[].shop_name` | string |
| `response.transaction_list[].withdrawal_id` | int |
| `response.transaction_list[].reason` | string (ADJUSTMENT_ADD / ADJUSTMENT_MINUS motivo) |
| `response.transaction_list[].root_withdrawal_id` | int |
| `response.transaction_list[].transaction_tab_type` | string |
| `response.transaction_list[].money_flow` | string (MONEY_IN / MONEY_OUT) |
| `response.transaction_list[].outlet_shop_name` | string |
| `request_id` | string |
| `error` | string |
| `message` | string |

### Error Codes
`error_auth`, `error_sign`, `error_param`, `error_data`, `error_shop`, `error_server`, `time_period_too_large`, `time_invalid`.

### Update Log
- **2024-11-01**: add `transaction_tab_type` and `money_flow` in request.
- **2022-11-03**: add `withdrawal_id` and `root_withdrawal_id`.
- **2022-09-26**: remove `shop_name`, `withdraw_id`, `root_withdrawal_id` response fields.
- **2022-06-24**: optimize `create_time_from`/`create_time_to` Required info.

---

## 4. `v2.payment.get_escrow_detail_batch`

**Método HTTP:** POST
**Path:** `/api/v2/payment/get_escrow_detail_batch`
**Descrição:** Use this API to fetch the details of order income by batch.
**Permissões:** ERP System, Seller In House System, Accounting And Finance, Swam ERP

### Request Parameters

| Nome | Tipo | Required | Descrição |
|------|------|----------|-----------|
| `order_sn_list` | string[] | **True** | Lista de `order_sn` (máx 50 por batch). |

### Request Example
```json
{
  "order_sn_list": [
    "2510102F4S56JW",
    "220725D58X..."
  ]
}
```

### Response Parameters

Estrutura: `response` é um **array** (`object[]`), onde cada item tem `escrow_detail` com a MESMA estrutura de `v2.payment.get_escrow_detail`:

```
response: object[]
└── response[].escrow_detail: object
    ├── order_sn: string
    ├── buyer_user_name: string
    ├── return_order_sn_list: string[]
    ├── order_income: object (mesmos 120+ campos financeiros do endpoint 1)
    └── buyer_payment_info: object (mesmos campos do endpoint 1)
```

Campos financeiros principais dentro de `response[].escrow_detail.order_income` (idênticos a `get_escrow_detail`): `escrow_amount`, `buyer_total_amount`, `commission_fee`, `service_fee`, `net_commission_fee`, `net_service_fee`, `ads_escrow_top_up_fee_or_technical_support_fee`, `pix_discount`, etc.

### Error Codes

`error_auth`, `error_data`, `error_param` (inclui `order_sn_list is required, format should be string[]`, `body not valid json`), `error_server`, `error_shop`, **`exceed_max_limit`** (*Your request exceeds the max limit of 50 orders*), `common.error_not_found`.

### Update Log

Mesmo ciclo de get_escrow_detail (2026-04-10 shopeevip_subtotal, 2026-03-27 bcrs_deposit, 2026-03-06 th_import_duty, 2026-02-09 pix_discount/ads_escrow_top_up_fee, 2025-12-26 net_commission_fee/net_service_fee/seller_product_rebate — BR local sellers).

---

## 5. `v2.payment.get_income_detail`

**Método HTTP:** GET
**Path:** `/api/v2/payment/get_income_detail`
**Descrição:** Retrieves detailed order-level income information across various income statuses for a specified time period. Dynamically adapts fields based on shop type (Local vs Cross Border) and income status (Pending / To Release / Released).
**Permissões:** ERP System, Seller In House System, Accounting And Finance

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `date_from` | string | **True** | `2025-09-25` | YYYY-MM-DD. Usado apenas para `income_status = Released`. |
| `date_to` | string | **True** | `2025-09-30` | YYYY-MM-DD. Precisa ser ≥ `date_from`. |
| `income_status` | int32 | **True** | `1` | Local: 1-Released, 2-Pending. CB: 0-To Release, 1-Released, 2-Pending. |
| `cursor` | string | False | `176714986216530` | Paginação. Vazio na primeira chamada. |
| `page_size` | int64 | **True** | `30` | Registros por página. |

### Response Parameters

| Nome | Tipo | Descrição |
|------|------|-----------|
| `error` / `message` / `request_id` | string | Erro e tracking. |
| `income_detail_list` | object | Container. |
| `income_detail_list.next_page` | object | Metadata de paginação. |
| `income_detail_list.next_page.cursor` | string | Cursor da próxima página ("" se não há mais). |
| `income_detail_list.next_page.page_size` | int32 | Records retornados. |
| `income_detail_list.income_detail_list_item` | object[] | Lista de detalhes. |
| `.payment_method` | string | Canal/método de pagamento (ex: `ATM Payment`, `Cash on Delivery`, `ShopeePay Balance`). |
| `.order_sn` | string | Serial do pedido. |
| `.type` | string | Tipo (`Order Income`, `Adjustment`, etc). |
| `.status` | string | Descrição do status (ex: *"The payment has been successfully transferred."*). |
| `.currency` | string | Moeda (Thai Baht, IDR, BRL, ...). |
| `.pending_amount` | float | Montante em escrow pendente. |
| `.estimated_payout_time` | int64 | Unix timestamp estimado (Pending/To Release). |
| `.to_release_amount` | float | Amount enfileirado para release (CB only). |
| `.create_time` | int64 | Timestamp de criação do pedido. |
| `.released_amount` | float | Amount efetivamente liberado. |
| `.actual_payout_time` | int64 | Unix timestamp do payout efetivo. |

### Request Example
```json
{
  "shop_id": 406906,
  "income_status": 1,
  "date_from": "2025-08-08",
  "date_to": "2025-08-20",
  "cursor": "",
  "limit": 5
}
```

### Response Example (ID local shop)
```json
{
  "error": "",
  "income_detail_list": {
    "list": [
      {"actual_payout_time": 1762532978, "currency": "IDR", "order_sn": "251101MPY3RDD3", "payment_method": "Cash on Delivery", "released_amount": 19246, "status": "Dana telah dilepaskan"},
      {"actual_payout_time": 1762532566, "currency": "IDR", "order_sn": "251102PVD4RMNF", "payment_method": "Cash on Delivery", "released_amount": 19125, "status": "Dana telah dilepaskan"},
      {"actual_payout_time": 1762530072, "currency": "IDR", "order_sn": "251101KV5GUESA", "payment_method": "ShopeePay Balance", "released_amount": 0, "status": "..."}
    ]
  }
}
```

### Error Codes
`error_auth`, `error_sign`, `error_param` (inclui *Invalid Time Range: Only records from the past 5 years are supported for the TW region*, *date range must not exceed 14 days*, *Access blocked for Mart shops, use Outlet Shop ID instead*), `error_shop`, `error_user_refresh_token`.

### Update Log
- **2025-10-31**: —
- **2025-10-21**: Update to add request and response example.
- **2025-10-14**: New API.

---

## 6. `v2.payment.get_income_overview`

**Método HTTP:** GET
**Path:** `/api/v2/payment/get_income_overview`
**Descrição:** Retrieves a consolidated snapshot of the seller's income amounts categorized by income status. Similar to Seller Center's "Income Overview". Historical income results are not retrievable.
**Permissões:** ERP System, Seller In House System, Accounting And Finance

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `income_status` | int32 | False | `1` | Local Shop: 1-Released, 2-Pending. CB Shop: 0-To Release, 1-Released, 2-Pending. Se omitido, retorna todos os status. |

### Response Parameters

| Nome | Tipo | Descrição |
|------|------|-----------|
| `error`/`message`/`request_id` | string | Erro/tracking. |
| `response` | object | Container. |
| `response.latest_payout_date` | string | Data mais recente de payout de income Released. Formato `YYYY-MM-DD`. **Apenas para CN shops.** |
| `response.total_income` | object | Componentes do income total. |
| `response.total_income.pending_amount` | float | Total pendente (Local: antes de ESCROW_PAID; CB: antes de ESCROW_PAYOUT). |
| `response.total_income.to_release_amount` | float | Amount enfileirado para o próximo ciclo de payout (**CB only**). |
| `response.total_income.released_amount` | float | Total já liberado ao vendedor. |

### Response Example
```json
{
  "error": "",
  "message": "",
  "request_id": "e3e3e7f34151e704736b612a6b9ae101",
  "total_income": {
    "pending_amount": 4010,
    "released_amount": 1545
  }
}
```

### Error Codes
`error_auth`, `error_param` (inclui *income_status provided is invalid or not applicable*; *Local shops do not have the "To Release" status*), `error_shop`, `error_user_refresh_token`.

### Update Log
- **2025-10-21**: x
- **2025-10-14**: New API.

---

## 7. `v2.payment.get_payout_detail`

**Método HTTP:** GET
**Path:** `/api/v2/payment/get_payout_detail`
**Descrição:** **Apenas para sellers Cross Border (CB).** Retorna dados de payout da loja (amount, currency, FX rate, orders associados e ajustes offline).
**Permissões:** ERP System, Seller In House System, Accounting And Finance, Swam ERP

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `page_size` | int | **True** | `10` | Max 100. |
| `page_no` | int | **True** | `1` | Min 1, default 1. |
| `payout_time_from` | timestamp | **True** | `1643365068` | Start time. Máx 15 dias de range. |
| `payout_time_to` | timestamp | **True** | `1659003469` | End time. |

### Response Parameters

```
response:
  more: boolean
  payout_list: object[]
    payout_info:
      from_currency: string        (moeda settlement)
      payout_currency: string      (moeda do payout)
      from_amount: float           (valor settlement)
      payout_amount: float         (valor do payout)
      exchange_rate: string
      payout_time: timestamp
      pay_service: string          (payoneer, pingpong, lianlian)
      payee_id: string             (conta do seller)
    escrow_list: object[]
      escrow_amount: float
      currency: string
      order_sn: string
    offline_adjustment_list: object[]
      adjustment_amount: float
      module: string               (ex: "Commission Fee")
      remark: string
      scenario: string
      adjustment_level: string     (shop, order)
      order_sn: string
```

### Response Example
```json
{
  "request_id": "5bd2a33faed0007f4883797f590e2a26",
  "error": "",
  "message": "",
  "response": {
    "more": false,
    "payout_list": [
      {
        "payout_info": {
          "from_currency": "VND", "payout_currency": "USD",
          "from_amount": 591797912, "payout_amount": 25678.64,
          "exchange_rate": "0.00", "payout_time": 1651842208,
          "pay_service": "Payoneer", "payee_id": "279016275538"
        },
        "escrow_list": [
          {"escrow_amount": 20865, "currency": "VND", "order_sn": "220404NF3CFFNY"},
          {"escrow_amount": 53122, "currency": "VND", "order_sn": "..."}
        ]
      }
    ]
  }
}
```

### Error Codes
`error_auth`, `error_sign`, `error_param` (inclui *This payment API is only applicable for cross boarder shop*, *The selected payout start time is not supported. Please choose a start time no earlier than May 1, 2022*, *This API is no longer available in this region*), `error_shop`, `error_server`.

### Update Log
- **2021-06-02**: update the `offline_adjustment_list`.

---

## 8. `v2.order.get_order_detail`

**Método HTTP:** GET
**Path:** `/api/v2/order/get_order_detail`
**Descrição:** Use this api to get order detail.
**Permissões:** ERP System, Seller In House System, Order Management, Accounting And Finance, Customer Service, Brand Membership, Ads Service, Swam ERP, Livestream Management, Affiliate Marketing Solution Management

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `order_sn_list` | string | **True** | `201214JAJXU6G7,201214JASXYXY6` | Lista de order_sn separados por vírgula (API aceita múltiplos). |
| `request_order_status_pending` | boolean | False | `true` | Incluir status "pending". |
| `response_optional_fields` | string | False | `total_amount` | Campos opcionais a retornar (CSV). |

### Response Parameters (131 campos)

**Top-level:**
- `request_id` (string), `error` (string), `message` (string), `warning` (string[])
- `response.order_list` (object[])

**`response.order_list[]` — campos principais para analytics financeira:**

| Campo | Tipo | Notas |
|-------|------|-------|
| `order_sn` | string | |
| `region` | string | |
| `currency` | string | |
| `cod` | boolean | Cash on Delivery. |
| **`total_amount`** | float | Valor total do pedido. |
| `pending_terms` | string[] | ex: `ARRANGE_SHIPMENT_PENDING`. |
| `pending_description` | string[] | Descrição correspondente aos pending_terms. |
| **`order_status`** | string | Status do pedido (UNPAID, READY_TO_SHIP, SHIPPED, COMPLETED, CANCELLED, etc). |
| `shipping_carrier` | string | |
| **`payment_method`** | string | |
| `estimated_shipping_fee` | float | |
| `actual_shipping_fee` | float | |
| `actual_shipping_fee_confirmed` | boolean | |
| `message_to_seller` | string | |
| `create_time` | timestamp | |
| `update_time` | timestamp | |
| `days_to_ship` | int32 | |
| `ship_by_date` | timestamp | |
| **`pay_time`** | timestamp | Momento do pagamento. |
| `buyer_user_id` | int64 | |
| `buyer_username` | string | |
| `buyer_cpf_id` | string | (BR) |
| `fulfillment_flag` | string | |
| `pickup_done_time` | timestamp | |
| `note` | string | |
| `note_update_time` | timestamp | |
| `dropshipper` | string | |
| `dropshipper_phone` | string | |
| `split_up` | boolean | |
| `buyer_cancel_reason` | string | |
| `cancel_by` | string | |
| `cancel_reason` | string | |
| `goods_to_declare` | boolean | |
| `checkout_shipping_carrier` | string | |
| `reverse_shipping_fee` | float | |
| `order_chargeable_weight_gram` | int | |
| `prescription_check_status` | int | |
| `pharmacist_name` | string | |
| `prescription_images` | string[] | |
| `prescription_approval_time` | timestamp | |
| `prescription_rejection_time` | timestamp | |
| `prescription_reject_reason` | string | |
| `is_buyer_shop_collection` | boolean | |
| `buyer_proof_of_collection` | string[] | |
| `edt_from` / `edt_to` | timestamp | |
| `booking_sn` | string | |
| `advance_package` | boolean | |
| `return_request_due_date` | timestamp | |
| **`hot_listing_order`** | boolean | |
| `is_international` | boolean | |

**`response.order_list[].recipient_address`:**
`name`, `phone`, `town`, `district`, `city`, `state`, `region`, `zipcode`, `full_address`, `geolocation.latitude`, `geolocation.longitude`.

**`response.order_list[].item_list[]` (lista de itens do pedido):**
`item_id` (int64), `item_name` (string), `item_sku` (string), `model_id` (int64), `model_name` (string), `model_sku` (string), `model_quantity_purchased` (int32), `model_original_price` (float), `model_discounted_price` (float), `wholesale` (bool), `weight` (float), `add_on_deal` (bool), `main_item` (bool), `add_on_deal_id` (int64), `promotion_type` (string), `promotion_id` (int64), `order_item_id` (int64), `promotion_group_id` (int32), `image_info.image_url` (string), `product_location_id` (string), `is_prescription_item` (bool), `consultation_id` (string), `is_b2c_owned_item` (bool), `promotion_list[]` (promotion_type, promotion_id), **`hot_listing_item`** (bool).

**`response.order_list[].package_list[]`:**
`package_number`, `logistics_status`, `logistics_channel_id`, `shipping_carrier`, `allow_self_design_awb`, `item_list[]` (item_id, model_id, model_quantity, order_item_id, promotion_group_id, product_location_id), `parcel_chargeable_weight`, `group_shipment_id`, `virtual_contact_number`, `package_query_number`, `sorting_group`.

**`response.order_list[].invoice_data`:** (BR)
`number`, `series_number`, `access_key`, `issue_date`, `total_value`, `products_total_value`, `tax_code`.

**`response.order_list[].payment_info[]`:**
`payment_method`, `payment_processor_register`, `card_brand`, `transaction_id`, **`payment_amount`** (float — amount efetivo cobrado).

### Error Codes
`error_not_found`, `error_param`, `error_permission`, `error_server`, `error_auth`, `error_sign`, `error_network`, `error_data`, `error_shop`.

### Update Log
- **2025-12-12**: Add `ARRANGE_SHIPMENT_PENDING` option for `pending_terms` + `pending_description`.
- **2025-12-03**: `shipping_carrier` logic updated for channels 90021/90025/90026 (service_code, ex: "Entrega Turbo - M1020"); add `geolocation` (latitude, longitude) em `recipient_address`.
- **2025-11-26**: Add `hot_listing_order` e `hot_listing_item`.
- **2025-11-13**: Add `promotion_list` em `item_list`.
- **2025-10-24**: Add `payment_amount` em `payment_info`.

---

## 9. `v2.ams.get_shop_performance` (AMS — Affiliate Marketing Solution)

**Módulo:** AMS
**Método HTTP:** GET
**Path:** `/api/v2/ams/get_shop_performance`
**Descrição:** Retrieve overall key metrics for all channels or specific channels (Affiliate Marketing).
**Permissões:** Affiliate Marketing Solution Management

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `period_type` | string | **True** | `Last30d` | Valores: `Day`, `Week`, `Month`, `Last7d`, `Last30d`. Alinhar start/end com Period Type. |
| `start_date` | string | **True** | `20250801` | `Day`: qualquer dia nos últimos 3 meses. `Week`: domingo. `Month`: 1º dia do mês. `Last7d`: D-6. |
| `end_date` | string | **True** | `20250831` | `Day`: = start_date. `Week`: sábado. `Month`: último dia do mês (ou ontem se mês corrente). |
| `order_type` | string | **True** | `ConfirmedOrder` | `PlacedOrder` (COD + non-COD, paid + unpaid) ou `ConfirmedOrder`. |
| `channel` | string | **True** | `AllChannel` | `AllChannel`, `SocialMedia`, `ShopeeVideo`, `LiveStreaming`. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `error`/`message`/`request_id` | string | | |
| `response.sales` | string | `15000` | Valor total de pedidos gerados por afiliados. |
| `response.gross_item_sold` | int64 | `9684221` | Total de itens vendidos via afiliados. |
| `response.orders` | int64 | `68` | Total de pedidos via afiliados. |
| `response.clicks` | int64 | `1564852` | Total de cliques nos links. |
| `response.est_commission` | string | `2000` | Payout estimado (commission). |
| `response.roi` | string | `18.8` | Sales / Est. Commission. `--` se inexistente. |
| `response.total_buyers` | int64 | `894` | Compradores totais via afiliados. |
| `response.new_buyers` | int64 | `260` | Novos compradores via afiliados. |
| `response.fetched_date_range` | string | `20250801-20250831` | Range efetivo consultado. |

### Response Example
```json
{
  "error": "",
  "message": "",
  "request_id": "b937c04e554847789cbf3fe33a0ad5f1",
  "response": {
    "sales": "15000",
    "gross_item_sold": 9684221,
    "orders": 68,
    "clicks": 1564852,
    "est_commission": "2000",
    "roi": "18.8",
    "total_buyers": 894,
    "new_buyers": 260,
    "fetched_date_range": "20250801-20250831"
  }
}
```

### Error Codes

| Error | Descrição |
|-------|-----------|
| `error_param` | invalid channel |
| `error_param` | invalid order type |
| `error_param` | invalid param |
| `error_param` | invalid period type |
| `error_param` | invalid time range, detail:{detail} |
| `error_server` | Something wrong. Please try later. |

### Update Log
- **2025-10-15**: New API.

---

## Apêndice — Confirmação de endpoints do módulo AMS

Esta é a lista dos endpoints AMS disponíveis (Affiliate Marketing Solution):
`get_open_campaign_added_product`, `get_open_campaign_not_added_product`, `batch_add_products_to_open_campaign`, `add_all_products_to_open_campaign`, `get_auto_add_new_product_toggle_status`, `update_auto_add_new_product_setting`, `batch_edit_products_open_campaign_setting`, `edit_all_products_open_campaign_setting`, `batch_remove_products_open_campaign_setting`, `remove_all_products_open_campaign_setting`, `get_open_campaign_batch_task_result`, `get_optimization_suggestion_product`, `batch_get_products_suggested_rate`, `get_shop_suggested_rate`, `get_targeted_campaign_addable_product_list`, `get_recommended_affiliate_list`, `get_managed_affiliate_list`, `query_affiliate_list`, `create_new_targeted_campaign`, `get_targeted_campaign_list`, `get_targeted_campaign_settings`, `update_basic_info_of_targeted_campaign`, `edit_product_list_of_targeted_campaign`, `edit_affiliate_list_of_targeted_campaign`, `terminate_targeted_campaign`, `get_performance_data_update_time`, **`get_shop_performance`**, `get_product_performance`, `get_affiliate_performance`, `get_content_performance`, `get_campaign_key_metrics_performance`, `get_open_campaign_performance`, `get_targeted_campaign_performance`, `get_conversion_report`, `get_validation_list`, `get_validation_report`.

## Sources

- [v2.payment.get_escrow_detail](https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail?module=97&type=1)
- [v2.payment.get_escrow_list](https://open.shopee.com/documents/v2/v2.payment.get_escrow_list?module=97&type=1)
- [v2.payment.get_wallet_transaction_list](https://open.shopee.com/documents/v2/v2.payment.get_wallet_transaction_list?module=97&type=1)
- [v2.payment.get_escrow_detail_batch](https://open.shopee.com/documents/v2/v2.payment.get_escrow_detail_batch?module=97&type=1)
- [v2.payment.get_income_detail](https://open.shopee.com/documents/v2/v2.payment.get_income_detail?module=97&type=1)
- [v2.payment.get_income_overview](https://open.shopee.com/documents/v2/v2.payment.get_income_overview?module=97&type=1)
- [v2.payment.get_payout_detail](https://open.shopee.com/documents/v2/v2.payment.get_payout_detail?module=97&type=1)
- [v2.order.get_order_detail](https://open.shopee.com/documents/v2/v2.order.get_order_detail?module=94&type=1)
- [v2.ams.get_shop_performance](https://open.shopee.com/documents/v2/v2.ams.get_shop_performance?module=120&type=1)
