# Shopee Open Platform — Documentação Complementar

Endpoints extraídos direto da API interna da Shopee (`/opservice/api/v1/doc/api/`) e lista de push events (`/opservice/api/v1/push/category`).

> Notação: `method: 2 / is_get_method: 0` = **GET** com params na query string. `method: 1` = **POST** com body JSON.

---

## 1. `v2.payment.get_income_overview`

**Método:** GET
**Path:** `/api/v2/payment/get_income_overview`
**Módulo:** Payment
**API Type:** Shop
**Descrição:** Retorna snapshot consolidado das receitas do seller, categorizadas por income status. Equivalente ao "Income Overview" do Seller Center. Dados dinâmicos conforme shop type (Local/CB) e income status. Resultados históricos não são recuperáveis.
**Permissões:** ERP System, Seller In House System, Accounting And Finance

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `income_status` | int32 | False | `1` | Local: 1-Released, 2-Pending. CB: 0-To Release, 1-Released, 2-Pending. Se omitido, retorna todos. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `error` | string | | Tipo de erro. |
| `message` | string | | Detalhe do erro. |
| `request_id` | string | | Identificador da requisição. |
| `response` | object | | Container. |
| `response.latest_payout_date` | string | `2025-08-19` | Data do último payout (Released). YYYY-MM-DD. **Apenas CN shops.** |
| `response.total_income` | object | | Componentes do income. |
| `response.total_income.pending_amount` | float | `330598.87` | Total pendente (Local: antes de ESCROW_PAID; CB: antes de ESCROW_PAYOUT). |
| `response.total_income.to_release_amount` | float | `330598.87` | Enfileirado para o próximo payout (**CB only**). |
| `response.total_income.released_amount` | float | `330598.87` | Total liberado ao seller. |

---

## 2. `v2.payment.generate_income_report`

**Método:** GET
**Path:** `/api/v2/payment/generate_income_report`
**Módulo:** Payment
**Descrição:** Dispara a geração assíncrona de um income report. Retorna um `id` que você usa depois em `get_income_report` para buscar o arquivo.

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `release_time_from` | int64 | **True** | `1234567890` | Start time (Unix epoch). |
| `release_time_to` | int64 | **True** | `1234567890` | End time (Unix epoch). |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `response` | object | | |
| `response.id` | int64 | `123456` | Identifier do arquivo do income report (usar em `get_income_report`). |
| `error` | string | | Error code. |
| `msg` | string | | Error message. |
| `request_id` | string | | Request ID. |

---

## 3. `v2.payment.get_income_report`

**Método:** GET
**Path:** `/api/v2/payment/get_income_report`
**Módulo:** Payment
**Descrição:** Consulta o status e link de download de um income report gerado por `generate_income_report`.

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `income_report_id` | int64 | **True** | `123456` | Id retornado por `generate_income_report`. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `response` | object | | |
| `response.id` | int64 | `123456` | Identifier do request. |
| `response.file_name` | string | `weekly_report_20241111.pdf` | Nome do arquivo. |
| `response.status` | int32 | `1` | `STATUS_INVALID=0`, `STATUS_PROCESSING=1`, `STATUS_DOWNLOADABLE=2`, `STATUS_DOWNLOADED=3`, `STATUS_FAILED=4`. |
| `response.generated_time` | int64 | `12345678987654` | Timestamp de geração. |
| `response.file_link` | string | `https://seller....accounting/pc/...` | URL para baixar o arquivo. |
| `error` | string | | Error code. |
| `msg` | string | | Error message. |
| `request_id` | string | | |

---

## 4. `v2.payment.generate_income_statement`

**Método:** GET
**Path:** `/api/v2/payment/generate_income_statement`
**Módulo:** Payment
**Descrição:** Gera um income statement (PDF semanal ou mensal). Retorna `id` para consulta via `get_income_statement`.

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `release_time_from` | int64 | **True** | `1751302800` | Weekly: deve ser segunda-feira (local time). Monthly: 1º dia do mês (local time). |
| `release_time_to` | int64 | **True** | `1753981199` | Weekly: deve ser domingo. Monthly: último dia do mês. |
| `statement_type` | int32 | **True** | `1` | `STATEMENT_TYPE_WEEKLY=1`, `STATEMENT_TYPE_MONTHLY=2`. **Obrigatório para Local sellers; não obrigatório para CB sellers.** |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `response` | object | | |
| `response.id` | int64 | `123456789` | Identifier do statement (usar em `get_income_statement`). |
| `error` | string | | Error code. |
| `message` | string | | Error message. |

---

## 5. `v2.payment.get_income_statement`

**Método:** GET
**Path:** `/api/v2/payment/get_income_statement`
**Módulo:** Payment
**Descrição:** Consulta o status e link do income statement gerado por `generate_income_statement`.

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `income_statement_id` | int64 | **True** | `123456` | Id retornado por `generate_income_statement`. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `response` | object | | |
| `response.id` | int64 | `123456` | Identifier. |
| `response.file_name` | string | `weekly_report_20241111.pdf` | Nome. |
| `response.status` | int32 | `1` | `STATUS_INVALID=0`, `STATUS_PROCESSING=1`, `STATUS_DOWNLOADABLE=2`, `STATUS_DOWNLOADED=3`, `STATUS_FAILED=4`. |
| `response.generated_time` | int64 | `12345678987654` | Timestamp de geração. |
| `response.file_link` | string | `https://seller....accounting/pc/...` | URL de download. |
| `error` | string | | |
| `message` | string | | |

---

## 6. `v2.payment.get_payout_info`

**Método:** GET
**Path:** `/api/v2/payment/get_payout_info`
**Módulo:** Payment

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `payout_time_from` | timestamp | **True** | `1643365068` | Start time. Max range 15 dias. |
| `payout_time_to` | timestamp | **True** | `1659003469` | End time. |
| `page_size` | int | **True** | `10` | Max 100. |
| `cursor` | string | **True** | `""` | Cursor de paginação. Vazio = primeira página. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `message` | string | | |
| `error` | string | | |
| `request_id` | string | | |
| `response` | object | | |
| `response.payout_list` | object | | |
| `response.payout_list.from_currency` | string | `SGD` | Moeda de settlement (ex.: BRL, SGD). |
| `response.payout_list.payout_currency` | string | `USD` | Moeda efetiva do payout. |
| `response.payout_list.from_amount` | float | `1769.01` | Valor de settlement. |
| `response.payout_list.payout_amount` | float | `1769.01` | Valor efetivo do payout. |
| `response.payout_list.exchange_rate` | string | `"1"` | FX rate. |
| `response.payout_list.payout_time` | timestamp | `1691050374` | Quando o payout foi feito. |
| `response.payout_list.pay_service` | string | `Payoneer` | Provider: `payoneer`, `pingpong`, `lianlian`. |
| `response.payout_list.payee_id` | string | `"279016275538"` | Conta do seller. |
| **`response.payout_list.encrypted_payout_id`** | string | `"16061973102097436445"` | **ID usado em `get_billing_transaction_info` para listar billing items detalhados deste payout.** |
| `response.more` | boolean | `false` | Se há mais páginas. |
| `response.next_cursor` | string | `""` | Cursor para próxima página; vazio = fim. |

---

## 7. `v2.payment.get_billing_transaction_info`

**Método:** POST
**Path:** `/api/v2/payment/get_billing_transaction_info`
**Módulo:** Payment

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `billing_transaction_info_type` | int | **True** | `1` | `1 = TO_RELEASE`, `2 = RELEASED`. |
| `encrypted_payout_ids` | string[] | False | `["10376329180766","637926329180767"]` | IDs de payout (obtidos em `get_payout_info`). Quando fornecido e `type=2`, retorna billing items "released" daquele payout. |
| `cursor` | string | **True** | `""` | Cursor de paginação. |
| `page_size` | int | **True** | `100` | Max 100. |

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `error` | string | | |
| `message` | string | | |
| `request_id` | string | | |
| `response` | object | | |
| `response.transactions` | object | | Cada transação. |
| `response.transactions.amount` | float | `-594.78` | Valor da transação. |
| `response.transactions.currency` | string | `SGD` | Moeda. |
| `response.transactions.order_sn` | string | | Pedido relacionado. |
| `response.transactions.cost_header` | string | `Refund Amount` | Tipo do custo (ex.: "Refund Amount", "Order Income"). |
| `response.transactions.scenario` | string | `Return Refund After Order Completed` | Cenário detalhado. |
| `response.transactions.remark` | string | `Deduction on return refund requests...` | Descrição detalhada. |
| `response.transactions.level` | string | `Order` | `Order` ou `shop` — nível do ajuste. |
| `response.transactions.billing_transaction_type` | string | `ADJUSTMENT` | `Escrow` (Order Income) ou `Adjustment`. |
| `response.transactions.billing_transaction_status` | string | `Released` | `To Release` ou `Released`. |
| `response.more` | boolean | `false` | |
| `response.next_cursor` | string | | |

---

## 8. `v2.returns.get_return_detail`

**Método:** GET
**Path:** `/api/v2/returns/get_return_detail`
**Módulo:** Returns

### Request Parameters

| Nome | Tipo | Required | Descrição |
|------|------|----------|-----------|
| `return_sn` | string | **True** | Serial do return. |

### Response Parameters (101 campos)

**Top-level:**
- `request_id`, `error`, `message`
- `response` (object)

**`response` — resumo do return:**

| Campo | Tipo |
|-------|------|
| `image` | string[] |
| `buyer_videos` | object[] → `thumbnail_url`, `video_url` |
| `reason` | string |
| `text_reason` | string |
| `reassessed_request_reason` | string |
| `return_sn` | string |
| `refund_amount` | float |
| `currency` | string |
| `create_time` | timestamp |
| `update_time` | timestamp |
| `status` | string |
| `due_date` | timestamp |
| `tracking_number` | string |
| `dispute_reason` | int32 |
| `dispute_text_reason` | string |
| `needs_logistics` | boolean |
| `amount_before_discount` | float |
| `order_sn` | string |
| `return_ship_due_date` | timestamp |
| `return_seller_due_date` | timestamp |
| `logistics_status` | string |
| `reverse_logistic_status` | string |
| `virtual_contact_number` | string |
| `package_query_number` | string |
| `return_refund_type` | string |
| `return_solution` | int32 |
| `is_seller_arrange` | boolean |
| `is_shipping_proof_mandatory` | boolean |
| `has_uploaded_shipping_proof` | boolean |
| `is_reverse_logistics_channel_integrated` | boolean |
| `reverse_logistic_channel_name` | string |
| `return_refund_request_type` | int32 |
| `validation_type` | string |
| `is_arrived_at_warehouse` | int32 |

**`response.user`:** `username`, `email`, `portrait`

**`response.item[]`:**
`model_id` (int64), `name`, `images` (string[]), `amount` (int32), `item_price` (float), `is_add_on_deal` (bool), `is_main_item` (bool), `add_on_deal_id` (int64), `item_id` (int64), `item_sku`, `variation_sku`, `refund_amount` (float).

**`response.activity[]`:**
`activity_id` (int64), `activity_type`, `original_price`, `discounted_price`, `items[]` (`item_id`, `variation_id`, `quantity_purchased`, `original_price`), `refund_amount`.

**`response.seller_proof`:** `seller_proof_status`, `seller_evidence_deadline` (timestamp).

**`response.seller_compensation`:** `seller_compensation_status`, `seller_compensation_due_date` (timestamp), `compensation_amount` (float).

**`response.negotiation`:** `negotiation_status`, `latest_solution`, `latest_offer_amount` (float), `latest_offer_creator`, `counter_limit` (int32), `offer_due_date` (timestamp).

**`response.return_pickup_address`:** `address`, `name`, `phone`, `town`, `district`, `city`, `state`, `region`, `zipcode`.

**`response.return_address`:** `whs_id`.

**`response.follow_up_action_list[]`:**
`item_id` (int64), `model_id` (int64), `qty` (int32), `current_status` (int32), `related_order_sn_list` (string[]), `resell_failed_next_step` (string).

---

## 9. `v2.order.get_order_list`

**Método:** GET
**Path:** `/api/v2/order/get_order_list`
**Módulo:** Order

### Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `time_range_field` | string | **True** | `create_time` | `create_time` ou `update_time`. |
| `time_from` | timestamp | **True** | `1607235072` | Start Unix. Usa o `time_range_field` para determinar o tipo. |
| `time_to` | timestamp | **True** | `1608271872` | End Unix. Max 15 dias de range. |
| `page_size` | int32 | **True** | `20` | Entries por página. |
| `cursor` | string | False | `""` | Cursor de paginação. |
| `order_status` | string | False | `READY_TO_SHIP` | Filtro. Valores: `UNPAID`, `READY_TO_SHIP`, `PROCESSED`, `SHIPPED`, `COMPLETED`, `IN_CANCEL`, `CANCELLED`, `INVOICE_PENDING`. |
| `response_optional_fields` | string | False | `order_status` | Campos opcionais a incluir na resposta. |
| `request_order_status_pending` | boolean | False | `true` | Compatibilidade — `true` habilita suporte ao status PENDING. |
| `logistics_channel_id` | int32 | False | `91007` | Filtro de canal logístico. **Válido apenas para BR.** |

### Response Parameters

| Nome | Tipo | Descrição |
|------|------|-----------|
| `request_id` | string | |
| `error` | string | (ex.: `common.error_auth`) |
| `message` | string | |
| `response` | object | |
| `response.more` | boolean | Se há mais páginas. |
| `response.order_list` | object[] | Lista de pedidos. |
| `response.order_list[].order_sn` | string | Serial do pedido. |
| `response.order_list[].order_status` | string | Status (UNPAID/READY_TO_SHIP/PROCESSED/SHIPPED/COMPLETED/IN_CANCEL/CANCELLED). |
| `response.order_list[].booking_sn` | string | Retornado por default. Só para advance fulfilment matched orders. |
| `response.next_cursor` | string | Passar no `cursor` da próxima request. Vazio quando `more=false`. |

---

## 10. `v2.push.get_lost_push_message`

**Método:** GET
**Path:** `/api/v2/push/get_lost_push_message`
**Módulo:** Push

### Request Parameters

Nenhum parâmetro específico além dos Common Parameters.

### Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `error` | string | | |
| `message` | string | | |
| `warning` | string | | |
| `request_id` | string | | |
| `response` | object | | |
| `response.push_message_list` | object[] | | Até 100 mensagens perdidas mais antigas nos últimos 3 dias ainda não confirmadas como consumidas. |
| `response.push_message_list[].shop_id` | int | `727720655` | Shop ID. Não retornado para pushes partner-level (códigos 1, 2, 12). |
| `response.push_message_list[].msg_id` | int | `3` | Identifier único da push notification. |
| `response.push_message_list[].timestamp` | timestamp | `1660123127` | Timestamp da perda da mensagem. |
| `response.push_message_list[].data` | string | `{"data":{"items":[],"ordersn":"...","st...` | Conteúdo principal da push message (JSON string). |
| `response.has_next_page` | boolean | `false` | True se há mais de 100 mensagens perdidas para consumir. |
| `response.last_message_id` | int | `176610` | Último msg_id retornado — usar para consumir via `confirm_consumed_lost_push_message`. |

**Observação:** endpoint correlato `v2.push.confirm_consumed_lost_push_message` é usado para confirmar que as mensagens foram processadas. Outros endpoints do módulo Push: `v2.push.set_app_push_config`, `v2.push.get_app_push_config`.

---

## 11. Push Events — lista completa com códigos

Fonte: `/opservice/api/v1/push/category`.

A Shopee organiza os push events em **categorias**. Cada evento tem um `push_api_id` (id interno da Shopee) e um `push_api_name`. No payload recebido pelo webhook, o campo `code` no JSON é o identificador que o listener deve usar para dispatch.

### Product Push (category_id 1000)

| push_api_id | push_api_name |
|-------------|---------------|
| 5 | `reserved_stock_change_push` |
| 11 | `video_upload_push` |
| 13 | `brand_register_result` |
| 18 | `violation_item_push` |
| 25 | `item_price_update_push` |
| 30 | `item_scheduled_publish_failed_push` |

### Order Push (category_id 1001)

| push_api_id | push_api_name |
|-------------|---------------|
| 1 | `order_status_push` |
| 2 | `order_trackingno_push` |
| 17 | `shipping_document_status_push` |
| 26 | `booking_status_push` |
| 27 | `booking_trackingno_push` |
| 28 | `booking_shipping_document_status_push` |
| 33 | `package_fulfillment_status_push` |
| 34 | `courier_delivery_binding_status_push` |
| 44 | `package_info_push` |

### Return Push (category_id 2078)

| push_api_id | push_api_name |
|-------------|---------------|
| 32 | `return_updates_push` |

### Marketing Push (category_id 1002)

| push_api_id | push_api_name |
|-------------|---------------|
| 6 | `item_promotion_push` |
| 7 | `promotion_update_push` |

### Shopee Push (category_id 1003)

| push_api_id | push_api_name |
|-------------|---------------|
| 3 | `shopee_updates` |
| 12 | `open_api_authorization_expiry` |
| 15 | `shop_authorization_push` |
| 16 | `shop_authorization_canceled_push` |
| 31 | `shop_penalty_update_push` |
| 43 | `video_upload_result_push` |

### Webchat Push (category_id 1004)

| push_api_id | push_api_name |
|-------------|---------------|
| 10 | `webchat_push` |

### Consignment Service Push (category_id 2063)

| push_api_id | push_api_name |
|-------------|---------------|
| 20 | `inbound_status_push` |
| 22 | `supplier_create_product_push` |
| 23 | `supplier_prouduct_review_result_push` |
| 24 | `purchase_order_Push` |

### Fulfillment by Shopee Push (category_id 2085)

| push_api_id | push_api_name |
|-------------|---------------|
| 36 | `fbs_sellable_stock` |
| 38 | `fbs_br_invoice_error_push` |
| 39 | `fbs_br_block_shop_push` |
| 40 | `fbs_br_block_sku_push` |
| 41 | `fbs_br_invoice_issued_push` |

### Retry strategy

Todos os push events usam `retry_strategy: [300, 1800, 10800]` — segundos após a primeira tentativa. Se seu endpoint responder 200 no ACK, não há retry. Se falhar, retry em 5min → 30min → 3h.

---

### Payload examples — eventos principais

**`order_status_push`** (push_api_id=1, payload `code=3`):
```json
{
  "data": {
    "items": [],
    "ordersn": "220810QSK8S7BX",
    "status": "PROCESSED",
    "completed_scenario": "",
    "update_time": 1660123127
  },
  "shop_id": 727720655,
  "code": 3,
  "timestamp": 1660123127
}
```
Update 2023-08-14 (Shopee): "Shopee now supports buyer to raise return & refund after order completed, for `order_status_push` add new field `completed_scenario` to indicate which COMPLETED status order is in."

Valores típicos de `status`: `UNPAID`, `READY_TO_SHIP`, `PROCESSED`, `SHIPPED`, `COMPLETED`, `IN_CANCEL`, `CANCELLED`, `INVOICE_PENDING`.

**`order_trackingno_push`** (push_api_id=2, payload `code=4`):
```json
{
  "data": {
    "ordersn": "220809MDBFYFT2",
    "forder_id": "4965804244309504855",
    "package_number": "OFG113701539238152",
    "tracking_no": "BR222263688572VSPXLM71894"
  },
  "shop_id": 296363855,
  "code": 4,
  "timestamp": 1660123089
}
```

**`shipping_document_status_push`** (push_api_id=17, payload `code=15`):
```json
{
  "data": {
    "ordersn": "201118BCKPJQQ8",
    "package_number": "2485710696837122445",
    "status": "READY"
  },
  "shop_id": 296363855,
  "code": 15,
  "timestamp": 1660123089
}
```

**`return_updates_push`** (push_api_id=32, payload `code=29`):
```json
{
  "data": {
    "order_sn": "241128EDQ9YKJ0",
    "return_sn": "2411280EDT4JRV5",
    "updated_values": [
      {
        "update_field": "return_status",
        "old_value": "JUDGING",
        "new_value": "PROCESSING",
        "update_time": 1732796767
      },
      {
        "update_field": "logistics_status",
        "old_value": "LOGISTICS_NOT_STARTED",
        "new_value": "LOGISTICS_PENDING_ARRANGE",
        "update_time": 1732796767
      }
    ]
  },
  "shop_id": 220004993,
  "code": 29,
  "timestamp": 1732796767
}
```

**`package_info_push`** (push_api_id=44, payload `code=47`):
```json
{
  "data": {
    "changed_fields": ["ship_by_date"],
    "old": {"logistics_channel_id": 70124, "ship_by_date": 1764573365},
    "new": {"logistics_channel_id": 70124, "ship_by_date": 1764746165},
    "order_sn": "2512017TFPB0HF",
    "package_number": "OFG218268963204539",
    "update_time": 1764569831
  },
  "shop_id": 220688102,
  "code": 47,
  "timestamp": 1764569832
}
```

**Observação importante sobre `code`:** o valor de `code` no payload **não é** o `push_api_id`. É um identificador separado para dispatch no webhook. Mapping conhecido (confirmado via amostras):

| push_api_id | push_api_name | `code` no payload |
|-------------|---------------|-------------------|
| 1 | order_status_push | **3** |
| 2 | order_trackingno_push | **4** |
| 17 | shipping_document_status_push | **15** |
| 32 | return_updates_push | **29** |
| 44 | package_info_push | **47** |

Para eventos não listados acima (booking_*, fbs_br_*, etc), verifique o `code` no payload real recebido pelo webhook ao ativar a subscription.

---

## Sources

- [v2.payment.get_income_overview](https://open.shopee.com/documents/v2/v2.payment.get_income_overview?module=97&type=1)
- [v2.payment.generate_income_report](https://open.shopee.com/documents/v2/v2.payment.generate_income_report?module=97&type=1)
- [v2.payment.get_income_report](https://open.shopee.com/documents/v2/v2.payment.get_income_report?module=97&type=1)
- [v2.payment.generate_income_statement](https://open.shopee.com/documents/v2/v2.payment.generate_income_statement?module=97&type=1)
- [v2.payment.get_income_statement](https://open.shopee.com/documents/v2/v2.payment.get_income_statement?module=97&type=1)
- [v2.payment.get_payout_info](https://open.shopee.com/documents/v2/v2.payment.get_payout_info?module=97&type=1)
- [v2.payment.get_billing_transaction_info](https://open.shopee.com/documents/v2/v2.payment.get_billing_transaction_info?module=97&type=1)
- [v2.returns.get_return_detail](https://open.shopee.com/documents/v2/v2.returns.get_return_detail?module=102&type=1)
- [v2.order.get_order_list](https://open.shopee.com/documents/v2/v2.order.get_order_list?module=94&type=1)
- [v2.push.get_lost_push_message](https://open.shopee.com/documents/v2/v2.push.get_lost_push_message?module=105&type=1)
- [Push Mechanism (categoria /push-mechanism)](https://open.shopee.com/push-mechanism)
