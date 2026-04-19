# Shopee Open Platform — Documentação Oficial (extrato)

Fontes:
- https://open.shopee.com/documents/v2/v2.product.get_category?module=89&type=1
- https://open.shopee.com/developer-guide/20 (Guia do desenvolvedor — Autorização, Autenticação e Fluxo de chamadas v2)

---

## 1. Base URLs

### 1.1 Endpoints de API (chamadas gerais — ex.: `/api/v2/product/get_category`)

Ambiente de **Produção**:

| Região / Mercado | Base URL |
|------------------|----------|
| Global (SG e demais mercados SEA/ID/PH/TH/VN/MY/TW/MX/CO/CL) | `https://partner.shopeemobile.com` |
| China Continental (CNSC) | `https://openplatform.shopee.cn` |
| Brasil (BR) | `https://openplatform.shopee.com.br` |

Ambiente de **Sandbox / Test**:

| Região / Mercado | Base URL |
|------------------|----------|
| Global (Sandbox SG) | `https://openplatform.sandbox.test-stable.shopee.sg` |
| China Continental (Sandbox CNSC) | `https://openplatform.sandbox.test-stable.shopee.cn` |

> Observação: a documentação oficial do endpoint `v2.product.get_category` lista exatamente estas 5 URLs (3 de produção + 2 de sandbox). Para o **Brasil**, a BASE URL de produção é `https://openplatform.shopee.com.br`. Não há URL de sandbox exclusiva para o Brasil listada — use a sandbox SG (`openplatform.sandbox.test-stable.shopee.sg`) para testes.

### 1.2 Endpoint de Autorização (fluxo OAuth — `auth_partner`)

Produção:
- `https://partner.shopeemobile.com/api/v2/shop/auth_partner`
- (China Continental) `https://openplatform.shopee.cn/api/v2/shop/auth_partner`

Sandbox:
- `https://openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/auth_partner`
- (China Continental) `https://openplatform.sandbox.test-stable.shopee.cn/api/v2/shop/auth_partner`

---

## 2. Common Parameters

Parâmetros comuns que aparecem em praticamente toda chamada à API v2 (o `sign` é obrigatório em todas; `access_token` e `shop_id` dependem do tipo de API):

| Nome | Tipo | Exemplo | Descrição |
|------|------|---------|-----------|
| `partner_id` | int | `1` | Partner ID atribuído quando o registro do app é concluído. **Obrigatório em todas as chamadas.** |
| `timestamp` | timestamp (int, Unix em segundos) | `1610000000` | Timestamp da requisição. **Obrigatório em todas as chamadas. Validade: 5 minutos.** |
| `access_token` | string | `c09222e3fc40ffb25fc947f738b1abf1` | Token de acesso à API. Usado para identificar a permissão na API. Pode ser reutilizado. **Validade: 4 horas.** |
| `shop_id` | int | `600000` | Identificador único da loja na Shopee. Obrigatório na maior parte das APIs (Shop APIs). |
| `sign` | string | `e318d3e932719916a9f9ebb57e2011961bd47abfa54a36e040d050d8931596e2` | Assinatura HMAC-SHA256 calculada a partir de `partner_id`, api path, `timestamp`, `access_token`, `shop_id` (depende do tipo de API) e `partner_key`. |

Parâmetros adicionais em fluxos específicos:
- `merchant_id` (int) — usado em Merchant APIs no lugar de `shop_id`.
- `redirect` (string) — usado apenas no fluxo de autorização (`/api/v2/shop/auth_partner`). URL para onde o usuário é redirecionado após autorizar.

---

## 3. Autenticação e Assinatura (sign)

### 3.1 Tipos de API e base string do `sign`

Existem **3 tipos de APIs** que usam bases diferentes para montar o `sign`. A `api path` deve ser o caminho relativo **sem host** (ex.: `/api/v2/product/get_category`).

| Tipo de API | Ordem da sign base string |
|-------------|---------------------------|
| Shop APIs | `partner_id` + `api path` + `timestamp` + `access_token` + `shop_id` |
| Merchant APIs | `partner_id` + `api path` + `timestamp` + `access_token` + `merchant_id` |
| Public APIs | `partner_id` + `api path` + `timestamp` |

A concatenação é **sequencial direta** (sem separadores); os valores são "colados" na ordem acima para formar a base string.

### 3.2 Algoritmo

1. Monte a `baseString` conforme o tipo de API acima.
2. Aplique **HMAC-SHA256** usando a `baseString` como mensagem e o `partner_key` como chave secreta.
3. O resultado deve ser codificado em **hexadecimal (lowercase)** — é este valor hex que vai no parâmetro `sign`.

### 3.3 Exemplo Python (fluxo de autorização)

```python
import hmac, json, time, requests, hashlib

def shop_auth():
    timest = int(time.time())
    host = "https://partner.shopeemobile.com"
    path = "/api/v2/shop/auth_partner"
    redirectUrl = "https://www.baidu.com/"
    partner_id = 80001
    partner_key = "test...."  # sua partner_key

    base_string = "%s%s%s" % (partner_id, path, timest)
    sign = hmac.new(
        partner_key.encode(),
        base_string.encode(),
        hashlib.sha256
    ).hexdigest()

    url = host + path + "?partner_id=%s&timestamp=%s&sign=%s&redirect=%s" % (
        partner_id, timest, sign, redirectUrl
    )
    print(url)
```

### 3.4 Exemplo de URL completa (autorização)

Produção:
```
https://partner.shopeemobile.com/api/v2/shop/auth_partner?partner_id=10090&redirect=https://open.shopee.com&timestamp=1594897040&sign=<hex>
```

Sandbox:
```
https://openplatform.sandbox.test-stable.shopee.sg/api/v2/shop/auth_partner?partner_id=1000016&redirect=<...>&timestamp=<...>&sign=<hex>
```

> Nota: o `timestamp` usado para calcular o `sign` só é válido por **5 minutos**. Após expirar, é preciso gerar novo `timestamp` + `sign`.

### 3.5 Validade da autorização e tokens

- **`access_token`**: válido por **4 horas**; renovável via `refresh_access_token`.
- **`refresh_token`**: usado para renovar o `access_token`.
- **Autorização do vendedor (app → shop)**: válida por até **365 dias**. Após vencer, o vendedor precisa reautorizar.
- Lojas SIP afiliadas têm permissões limitadas em relação à loja principal.

---

## 4. Endpoint `v2.product.get_category`

### 4.1 Resumo

- **Nome**: `v2.product.get_category`
- **Método HTTP**: `GET`
- **Path**: `/api/v2/product/get_category`
- **Tipo de API**: Shop API (requer `access_token` e `shop_id`)
- **Descrição**: Retorna a árvore (tree) de categorias disponíveis para a loja. Referência adicional: `https://open.shopee.com/developer-guide/209`

### 4.2 URL completa por ambiente

| Ambiente | URL |
|----------|-----|
| Produção (Global) | `https://partner.shopeemobile.com/api/v2/product/get_category` |
| Produção (China Continental) | `https://openplatform.shopee.cn/api/v2/product/get_category` |
| Produção (Brasil) | `https://openplatform.shopee.com.br/api/v2/product/get_category` |
| Sandbox (Global) | `https://openplatform.sandbox.test-stable.shopee.sg/api/v2/product/get_category` |
| Sandbox (China Continental) | `https://openplatform.sandbox.test-stable.shopee.cn/api/v2/product/get_category` |

### 4.3 Common Parameters

(ver seção 2 — `partner_id`, `timestamp`, `access_token`, `shop_id`, `sign`)

### 4.4 Request Parameters

| Nome | Tipo | Required | Sample | Descrição |
|------|------|----------|--------|-----------|
| `language` | string | **False** | `zh-hans` | Idioma da resposta. Default: `en`. Idiomas suportados por mercado: SG: `en`; MY: `en / ms-my / zh-hans`; TH: `en / th`; VN: `en / vi`; PH: `en`; TW: `en / zh-hant`; ID: `en / id`; **BR: `en / pt-br`**; MX: `en / es-mx`; CO: `en / es-CO`; CL: `en / es-CL`. Em mercados já na "global tree", lojas Crossborder só retornam `en` e `zh-hans`. |

### 4.5 Response Parameters

| Nome | Tipo | Sample | Descrição |
|------|------|--------|-----------|
| `error` | string | | Tipo de erro. Vazio se não houve erro. |
| `message` | string | | Detalhes do erro. Vazio se não houve erro. |
| `warning` | string | | Mensagem de aviso. |
| `request_id` | string | | Identificador da requisição para rastreamento de erros. |
| `response` | object | | Objeto com a resposta. |
| `response.category_list` | object[] | | Lista de categorias. |
| `response.category_list[].category_id` | int64 | `1234` | ID da categoria. |
| `response.category_list[].parent_category_id` | int64 | `1234` | ID da categoria-pai. |
| `response.category_list[].original_category_name` | string | `内衣` | Nome padrão (interno) da categoria. |
| `response.category_list[].display_category_name` | string | `内衣` | Nome de exibição, dependente do idioma. |
| `response.category_list[].has_children` | boolean | `false` | Indica se a categoria tem subcategorias ativas. |

### 4.6 Exemplos de Request

**cURL**
```bash
curl --location --request GET \
  'https://partner.shopeemobile.com/api/v2/product/get_category?access_token=access_token&timestamp=timestamp&sign=sign&shop_id=shop_id&partner_id=partner_id&language=zh-hans'
```

**Python (requests)**
```python
import requests

url = "https://partner.shopeemobile.com/api/v2/product/get_category?access_token=access_token&language=zh-hans&partner_id=partner_id&shop_id=shop_id&sign=sign&timestamp=timestamp"
headers = {}
payload = {}
response = requests.request("GET", url, headers=headers, data=payload, allow_redirects=False)
print(response.text)
```

**PHP (cURL)**
```php
<?php
$curl = curl_init();
curl_setopt_array($curl, array(
  CURLOPT_URL => 'https://partner.shopeemobile.com/api/v2/product/get_category?access_token=access_token&language=zh-hans&partner_id=partner_id&shop_id=shop_id&sign=sign&timestamp=timestamp',
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_CUSTOMREQUEST => 'GET',
  CURLOPT_HTTPHEADER => array('Content-Type: application/json'),
));
$response = curl_exec($curl);
curl_close($curl);
echo $response;
```

**Java (Unirest)**
```java
Unirest.setTimeouts(0, 0);
HttpResponse<String> response = Unirest
  .get("https://partner.shopeemobile.com/api/v2/product/get_category?language=zh-hans&access_token=access_token&timestamp=timestamp&sign=sign&shop_id=shop_id&partner_id=partner_id")
  .asString();
```

### 4.7 Response Example (sucesso)

```json
{
  "error": "",
  "message": "",
  "warning": "",
  "request_id": "aaaaaaa",
  "response": {
    "category_list": [
      {
        "category_id": 123,
        "parent_category_id": 456,
        "original_category_name": "aaa",
        "display_category_name": "bbb",
        "has_children": false
      }
    ]
  }
}
```

### 4.8 Error Example

```json
{
  "request_id": "83ff790ff92c822fdd02cfd33b7900f8",
  "error": "error_auth",
  "message": "Invalid partner_id or shopid."
}
```

### 4.9 Error Codes

| Error | Descrição |
|-------|-----------|
| `err_data` | Cannot accept your own offer. |
| `error_param` | There is no access_token in query. |
| `error_auth` | Invalid access_token. |
| `error_param` | Invalid partner_id. |
| `error_param` | There is no partner_id in query. |
| `error_auth` | No permission to current api. |
| `error_param` | There is no sign in query. |
| `error_sign` | Wrong sign. |
| `error_param` | no timestamp |
| `error_param` | Invalid timestamp |
| `error_network` | Inner http call failed |
| `error_data` | parse data failed |
| `error_data` | data not exist |
| `error_param` | parameter invalid |
| `error_param` | The information you queried is not found. |
| `error_param` | Wrong parameters, detail: {msg}. |
| `error_server` | Something wrong. Please try later. |
| `error_shop` | shopid is invalid |
| `error_param` | request not from gateway |
| `error_param_shop_id_not_found` | Shop_id is not found. |
| `error_invalid_language` | Invalid language. |
| `error_inner` | Our system is taking some time to respond, please try later. |
| `error_inner` | System error, please try again later or contact the OpenAPI support team. |
| `error_item_not_found` | Product not found |
| `error_inner` | Update item failed {{.error_info}} |
| `error_auth` | Your shop can not use model level dts |
| `error_system_busy` | Our system is taking some time to respond, please try later. |

### 4.10 API Permissions

Tipos de APP que podem chamar esta API:
- ERP System
- Seller In House System
- Product Management
- Customized APP
- Ads Service
- Swam ERP
- Livestream Management
- Ads Facil
- Affiliate Marketing Solution Management
- Shopee Video Management

### 4.11 Update Log

| Data | Atualização |
|------|-------------|
| 2021-10-29 | update language description |
| 2021-09-29 | update language description |
| 2021-07-05 | update language description |

---

## 5. Estrutura do Menu Lateral (módulos e endpoints)

O menu lateral da página `v2.product.get_category` expõe a seguinte estrutura de módulos da API v2. Dentro de cada módulo estão os endpoints disponíveis.

### Tabela de Conteúdo (TOC) da própria página
- v2.product.get_category
- Common Parameters
- Request Parameters
- Response Parameters
- Request Example
- Response Example
- Error Example
- Error Codes
- API Permissions
- Update Log

### Módulos disponíveis

**AMS (Ads Management System)**
- `get_open_campaign_added_product`, `get_open_campaign_not_added_product`, `batch_add_products_to_open_campaign`, `add_all_products_to_open_campaign`, `get_auto_add_new_product_toggle_status`, `update_auto_add_new_product_setting`, `batch_edit_products_open_campaign_setting`, `edit_all_products_open_campaign_setting`, `batch_remove_products_open_campaign_setting`, `remove_all_products_open_campaign_setting`, `get_open_campaign_batch_task_result`, `get_optimization_suggestion_product`, `batch_get_products_suggested_rate`, `get_shop_suggested_rate`, `get_targeted_campaign_addable_product_list`, `get_recommended_affiliate_list`, `get_managed_affiliate_list`, `query_affiliate_list`, `create_new_targeted_campaign`, `get_targeted_campaign_list`, `get_targeted_campaign_settings`, `update_basic_info_of_targeted_campaign`, `edit_product_list_of_targeted_campaign`, `edit_affiliate_list_of_targeted_campaign`, `terminate_targeted_campaign`, `get_performance_data_update_time`, `get_shop_performance`, `get_product_performance`, `get_affiliate_performance`, `get_content_performance`, `get_campaign_key_metrics_performance`, `get_open_campaign_performance`, `get_targeted_campaign_performance`, `get_conversion_report`, `get_validation_list`, `get_validation_report`

**Video**
- `get_cover_list`, `edit_video_info`, `post_video`, `get_video_list`, `get_video_detail`, `delete_video`, `get_overview_performance`, `get_metric_trend`, `get_user_demographics`, `get_video_performance_list`, `get_prodcut_performance_list`, `get_video_detail_performance`, `get_video_detail_metric_trend`, `get_video_detail_audience_distribution`, `get_video_detail_product_performance`

**Product**
- `get_category`, `get_attribute_tree`, `get_brand_list`, `get_item_limit`, `get_item_list`, `get_item_base_info`, `get_item_extra_info`, `add_item`, `update_item`, `delete_item`, `init_tier_variation`, `update_tier_variation`, `get_model_list`, `add_model`, `update_model`, `delete_model`, `unlist_item`, `update_price`, `update_stock`, `boost_item`, `get_boosted_list`, `get_item_promotion`, `update_sip_item_price`, `search_item`, `get_comment`, `reply_comment`, `category_recommend`, `register_brand`, `get_recommend_attribute`, `get_weight_recommendation`, `get_size_chart_list`, `get_size_chart_detail`, `get_item_violation_info`, `get_variations`, `get_all_vehicle_list`, `get_vehicle_list_by_compatibility_detail`, `get_item_content_diagnosis_result`, `get_item_list_by_content_diagnosis`, `get_kit_item_limit`, `add_kit_item`, `update_kit_item`, `get_kit_item_info`, `get_ssp_list`, `get_ssp_info`, `add_ssp_item`, `link_ssp`, `unlink_ssp`, `get_aitem_by_pitem_id`, `search_attribute_value_list`, `get_main_item_list`, `get_direct_item_list`, `get_direct_shop_recommended_price`, `get_product_certification_rule`, `v2.product.publish_item_to_outlet_shop`, `get_mart_item_mapping_by_id`, `search_unpackaged_model_list`, `generate_kit_image`

**GlobalProduct**
- `get_category`, `get_attribute_tree`, `get_brand_list`, `get_global_item_limit`, `get_global_item_list`, `get_global_item_info`, `add_global_item`, `update_global_item`, `delete_global_item`, `init_tier_variation`, `update_tier_variation`, `add_global_model`, `update_global_model`, `delete_global_model`, `get_global_model_list`, `support_size_chart`, `update_size_chart`, `create_publish_task`, `get_publishable_shop`, `get_publish_task_result`, `get_published_list`, `update_price`, `update_stock`, `set_sync_field`, `get_global_item_id`, `category_recommend`, `get_recommend_attribute`, `get_shop_publishable_status`, `get_variations`, `get_size_chart_detail`, `get_size_chart_list`, `search_global_attribute_value_list`, `get_local_adjustment_rate`, `update_local_adjustment_rate`

**MediaSpace**
- `init_video_upload`, `upload_video_part`, `complete_video_upload`, `get_video_upload_result`, `cancel_video_upload`, `upload_image`

**Media**
- `upload_image`, `init_video_upload`, `upload_video_part`, `complete_video_upload`, `get_video_upload_result`, `cancel_video_upload`

**Shop**
- `get_shop_info`, `get_profile`, `update_profile`, `get_warehouse_detail`, `get_shop_notification`, `get_authorised_reseller_brand`, `get_fbs_br_tax_rule`, `get_br_shop_onboarding_info`, `get_shop_holiday_mode`, `set_shop_holiday_mode`

**Merchant**
- `get_merchant_info`, `get_shop_list_by_merchant`, `get_merchant_warehouse_location_list`, `get_merchant_warehouse_list`, `get_warehouse_eligible_shop_list`, `get_merchant_prepaid_account_list`

**Order**
- `get_order_list`, `get_order_detail`, `get_shipment_list`, `search_package_list`, `get_package_detail`, `split_order`, `unsplit_order`, `cancel_order`, `handle_buyer_cancellation`, `set_note`, `get_pending_buyer_invoice_order_list`, `get_buyer_invoice_info`, `upload_invoice_doc`, `download_invoice_doc`, `handle_prescription_check`, `get_warehouse_filter_config`, `get_booking_list`, `get_booking_detail`, `generate_fbs_invoices`, `get_fbs_invoices_result`, `download_fbs_invoices`

**Logistics**
- `get_shipping_parameter`, `get_mass_shipping_parameter`, `ship_order`, `mass_ship_order`, `update_shipping_order`, `get_tracking_number`, `get_mass_tracking_number`, `get_shipping_document_parameter`, `create_shipping_document`, `get_shipping_document_result`, `download_shipping_document`, `get_shipping_document_data_info`, `get_tracking_info`, `get_address_list`, `set_address_config`, `update_address`, `delete_address`, `get_channel_list`, `update_channel`, `get_operating_hours`, `get_operating_hour_restrictions`, `update_operating_hours`, `delete_special_operating_hour`, `batch_update_tpf_warehouse_tracking_status`, `batch_ship_order`, `update_tracking_status`, `get_booking_shipping_parameter`, `ship_booking`, `get_booking_tracking_number`, `get_booking_shipping_document_parameter`, `create_booking_shipping_document`, `get_booking_shipping_document_result`, `download_booking_shipping_document`, `get_booking_shipping_document_data_info`, `get_booking_tracking_info`, `download_to_label`, `create_shipping_document_job`, `get_shipping_document_job_status`, `download_shipping_document_job`, `update_self_collection_order_logistics`, `get_mart_packaging_info`, `set_mart_packaging_info`, `upload_serviceable_polygon`, `check_polygon_update_status`, `get_pause_status`, `set_pause_status`

**FirstMile**
- `get_unbind_order_list`, `get_detail`, `generate_first_mile_tracking_number`, `bind_first_mile_tracking_number`, `unbind_first_mile_tracking_number`, `get_tracking_number_list`, `get_waybill`, `get_channel_list`, `get_courier_delivery_channel_list`, `get_transit_warehouse_list`, `generate_and_bind_first_mile_tracking_number`, `bind_courier_delivery_first_mile_tracking_number`, `unbind_first_mile_tracking_number_all`, `get_courier_delivery_detail`, `get_courier_delivery_waybill`, `get_courier_delivery_tracking_number_list`

**Payment**
- `get_escrow_detail`, `set_shop_installment_status`, `get_shop_installment_status`, `get_payout_detail`, `set_item_installment_status`, `get_item_installment_status`, `get_payment_method_list`, `get_wallet_transaction_list`, `get_escrow_list`, `get_payout_info`, `get_billing_transaction_info`, `get_escrow_detail_batch`, `generate_income_statement`, `get_income_statement`, `generate_income_report`, `get_income_report`, `get_income_overview`, `get_income_detail`

**Discount**
- `add_discount`, `add_discount_item`, `delete_discount`, `delete_discount_item`, `get_discount`, `get_discount_list`, `update_discount`, `update_discount_item`, `end_discount`, `get_sip_discounts`, `set_sip_discount`, `delete_sip_discount`

**Bundle Deal**
- `add_bundle_deal`, `add_bundle_deal_item`, `get_bundle_deal_list`, `get_bundle_deal`, `get_bundle_deal_item`, `update_bundle_deal`, `update_bundle_deal_item`, `end_bundle_deal`, `delete_bundle_deal`, `delete_bundle_deal_item`

**Add-On Deal**
- `add_add_on_deal`, `add_add_on_deal_main_item`, `add_add_on_deal_sub_item`, `delete_add_on_deal`, `delete_add_on_deal_main_item`, `delete_add_on_deal_sub_item`, `get_add_on_deal_list`, `get_add_on_deal`, `get_add_on_deal_main_item`, `get_add_on_deal_sub_item`, `update_add_on_deal`, `update_add_on_deal_main_item`, `update_add_on_deal_sub_item`, `end_add_on_deal`

**Voucher**
- `add_voucher`, `delete_voucher`, `end_voucher`, `update_voucher`, `get_voucher`, `get_voucher_list`

**ShopFlashSale**
- `get_time_slot_id`, `create_shop_flash_sale`, `get_item_criteria`, `add_shop_flash_sale_items`, `get_shop_flash_sale_list`, `get_shop_flash_sale`, `get_shop_flash_sale_items`, `update_shop_flash_sale`, `update_shop_flash_sale_items`, `delete_shop_flash_sale`, `delete_shop_flash_sale_items`

**Follow Prize**
- `add_follow_prize`, `delete_follow_prize`, `end_follow_prize`, `update_follow_prize`, `get_follow_prize_detail`, `get_follow_prize_list`

**TopPicks**
- `get_top_picks_list`, `add_top_picks`, `update_top_picks`, `delete_top_picks`

**ShopCategory**
- `add_shop_category`, `get_shop_category_list`, `delete_shop_category`, `update_shop_category`, `add_item_list`, `get_item_list`, `delete_item_list`

**Returns**
- `get_return_list`, `get_return_detail`, `confirm`, `dispute`, `get_available_solutions`, `offer`, `accept_offer`, `convert_image`, `upload_proof`, `query_proof`, `get_return_dispute_reason`, `cancel_dispute`, `get_shipping_carrier`, `upload_shipping_proof`, `get_reverse_tracking_info`

**AccountHealth**
- `get_shop_performance`, `get_metric_source_detail`, `get_penalty_point_history`, `get_punishment_history`, `get_listings_with_issues`, `get_late_orders`

**Ads**
- `get_total_balance`, `get_shop_toggle_info`, `get_recommended_keyword_list`, `get_recommended_item_list`, `get_all_cpc_ads_hourly_performance`, `get_all_cpc_ads_daily_performance`, `(coming offline soon) v2.ads.create_auto_product_ads`, `(coming offline soon) v2.ads.edit_auto_product_ads`, `get_product_campaign_daily_performance`, `get_product_campaign_hourly_performance`, `get_product_level_campaign_id_list`, `get_product_level_campaign_setting_info`, `create_manual_product_ads`, `edit_manual_product_ad_keywords`, `edit_manual_product_ads`, `get_create_product_ad_budget_suggestion`, `get_product_recommended_roi_target`, `get_ads_fácil_shop_rate`, `check_create_gms_product_campaign_eligibility`, `create_gms_product_campaign`, `edit_gms_product_campaign`, `list_gms_user_deleted_item`, `edit_gms_item_product_campaign`, `get_gms_campaign_performance`, `get_gms_item_performance`

**Public** *(APIs públicas — não requerem `access_token` / `shop_id`; usam apenas `partner_id`, `timestamp`, `sign`)*
- `get_shops_by_partner`, `get_merchants_by_partner`, `get_access_token`, `refresh_access_token`, `get_token_by_resend_code`, `get_shopee_ip_ranges`

**Push**
- `set_app_push_config`, `get_app_push_config`, `get_lost_push_message`, `confirm_consumed_lost_push_message`

**SBS (Shopee Business Service / Warehouse)**
- `get_bound_whs_info`, `get_current_inventory`, `get_expiry_report`, `get_stock_aging`, `get_stock_movement`

**FBS (Fulfilled by Shopee)**
- `query_br_shop_enrollment_status`, `query_br_shop_invoice_error`, `query_br_shop_block_status`, `query_br_sku_block_status`

**Livestream**
- `upload_image`, `create_session`, `update_session`, `start_session`, `end_session`, `get_session_detail`, `add_item_list`, `delete_item_list`, `update_item_list`, `get_item_count`, `get_item_list`, `update_show_item`, `delete_show_item`, `get_show_item`, `get_like_item_list`, `get_recent_item_list`, `get_item_set_list`, `get_item_set_item_list`, `apply_item_set`, `get_session_metric`, `get_session_item_metric`, `get_latest_comment_list`, `post_comment`, `ban_user_comment`, `unban_user_comment`

---

## Notas finais e observações

- Todos os parâmetros comuns (`partner_id`, `timestamp`, `sign`) são **obrigatórios em todas as chamadas**. `access_token` e `shop_id` (ou `merchant_id`) são obrigatórios conforme o tipo de API (Shop / Merchant / Public).
- O `timestamp` deve ser o **mesmo** usado na base string do `sign`. Ambos expiram em 5 minutos.
- O `partner_key` é a chave secreta do app — **nunca** deve ser enviada na requisição, apenas usada como chave HMAC-SHA256 para gerar o `sign`.
- Para Brasil, use: Base URL de produção `https://openplatform.shopee.com.br`, idioma de resposta `pt-br` (no campo `language`), e — por ora — a sandbox SG (`openplatform.sandbox.test-stable.shopee.sg`) para testes.
- Documento gerado a partir da documentação oficial em inglês (com rótulos em pt-BR na parte do Guia do Desenvolvedor, por efeito da interface em PT). Os nomes e paths dos endpoints seguem exatamente a especificação em inglês.

Sources:
- [v2.product.get_category — Shopee Open Platform](https://open.shopee.com/documents/v2/v2.product.get_category?module=89&type=1)
- [Guia do desenvolvedor — Autorização, Autenticação e Fluxo v2](https://open.shopee.com/developer-guide/20)
