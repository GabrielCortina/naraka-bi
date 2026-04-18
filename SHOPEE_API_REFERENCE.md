# SHOPEE API v2 — REFERÊNCIA TÉCNICA PARA DESENVOLVIMENTO

> Este documento é a fonte da verdade sobre a API da Shopee para o projeto NARAKA-BI.
> Consulte ANTES de implementar qualquer funcionalidade relacionada à Shopee.
> Classificação: [C] Confirmado | [I] Inferência provável | [?] Precisa teste prático

---

## 1. CREDENCIAIS E AMBIENTES

```
Test Partner ID: 1232147
App Category: Seller In House System (acesso total a todas as APIs)
App Status: Developing (sandbox)
Redirect URL: https://naraka-bi.vercel.app
Sandbox Host: https://openplatform.sandbox.test-stable.shopee.sg  [C — confirmado via API Test Tool]
Production Host: https://partner.shopeemobile.com
API Base Path: /api/v2/

⚠️ ATENÇÃO: o host `partner.test-stable.shopeemobile.com` (divulgado em diversas
fontes) devolve "Wrong sign" mesmo com a assinatura correta. Usar sempre
`openplatform.sandbox.test-stable.shopee.sg` em sandbox.
```

**Regra:** Nunca expor partner_key no frontend. Toda chamada Shopee pelo backend (API Routes).

---

## 2. AUTENTICAÇÃO OAuth 2.0

### Fluxo completo [C]

1. **Gerar URL de autorização:**
   ```
   GET {host}/api/v2/shop/auth_partner
   ?partner_id={partner_id}
   &timestamp={unix_seconds}
   &sign={sign}
   &redirect={redirect_url}
   ```
   - sign = HMAC-SHA256(partner_key, `{partner_id}/api/v2/shop/auth_partner{timestamp}`)
   - URL válida por 5 minutos

2. **Seller autoriza** → redirect para `{redirect_url}?code={code}&shop_id={shop_id}`

3. **Trocar code por token:**
   ```
   POST {host}/api/v2/auth/token/get
   ?partner_id={partner_id}&timestamp={ts}&sign={sign}
   Body: { code, shop_id, partner_id }
   ```
   - sign = HMAC-SHA256(partner_key, `{partner_id}/api/v2/auth/token/get{timestamp}`)
   - Retorna: { access_token, refresh_token, expire_in: 14400 }

4. **Refresh token:**
   ```
   POST {host}/api/v2/auth/access_token/get
   ?partner_id={partner_id}&timestamp={ts}&sign={sign}
   Body: { refresh_token, shop_id, partner_id }
   ```
   - sign = HMAC-SHA256(partner_key, `{partner_id}/api/v2/auth/access_token/get{timestamp}`)
   - Retorna novo par access_token + refresh_token
   - **CRÍTICO:** refresh_token anterior é INVALIDADO. Salvar o novo imediatamente.

### Tempos de expiração [C]
- access_token: **4 horas** (14400 segundos)
- refresh_token: **30 dias** (rotativo — cada refresh gera novo)
- Timestamp na URL: expira em **5 minutos**

### Assinatura para chamadas autenticadas [C]
```
sign = HMAC-SHA256(partner_key, {partner_id}{path}{timestamp}{access_token}{shop_id})
```
- Todos os parâmetros comuns vão na QUERY STRING (não no header)
- Body vai como JSON em POST
- GET usa query params para dados

### Erros comuns [C]
- "Invalid sign" → verificar ordem exata do base_string e se ambiente (test/live) bate com as chaves
- "Invalid timestamp" → drift de relógio ou timestamp em milissegundos (deve ser SEGUNDOS)
- "Invalid access_token" → token expirado, fazer refresh

---

## 3. MÓDULOS E ENDPOINTS DISPONÍVEIS

### 3.1 Order (Pedidos) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/order/get_order_list | GET | Lista pedidos por período (janela ~15 dias max [I]) |
| /api/v2/order/get_order_detail | POST | Detalhes de até 50 pedidos por chamada |
| /api/v2/order/get_shipment_list | GET | Pedidos READY_TO_SHIP |
| /api/v2/order/cancel_order | POST | Cancelar pedido |
| /api/v2/order/handle_buyer_cancellation | POST | Aceitar/rejeitar cancelamento do buyer |
| /api/v2/order/split_order | POST | Dividir pedido em pacotes |
| /api/v2/order/unsplit_order | POST | Desfazer split |
| /api/v2/order/set_note | POST | Adicionar nota ao pedido |
| /api/v2/order/add_invoice_data | POST | Adicionar dados de NF |

**Status de pedido (enum):** UNPAID, READY_TO_SHIP, PROCESSED, RETRY_SHIP, SHIPPED, TO_CONFIRM_RECEIVE, IN_CANCEL, CANCELLED, TO_RETURN, COMPLETED

**get_order_list params:**
- time_range_field: "create_time" ou "update_time"
- time_from / time_to: unix timestamp (janela max ~15 dias [I])
- page_size: max 100
- cursor: string para paginação
- order_status: filtro opcional
- response_optional_fields: campos extras a incluir

### 3.2 Payment / Escrow (Financeiro) [C] — NÚCLEO DO MÓDULO FINANCEIRO

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/payment/get_escrow_detail | GET | **Detalhamento financeiro completo por pedido** |
| /api/v2/payment/get_escrow_list | GET | Lista de escrows por período de release [C] |
| /api/v2/payment/get_payout_detail | GET | Detalhes de repasse/saque [I] |
| /api/v2/payment/get_wallet_transaction_list | GET | Transações da carteira (entradas, saídas, ajustes) [C] |

**get_escrow_detail — campos retornados [C]:**
```
{
  order_sn: string,
  buyer_total_amount: number,        // Valor total pago pelo comprador
  escrow_amount: number,             // Valor líquido para o seller
  commission_fee: number,            // Comissão Shopee
  service_fee: number,               // Taxa de serviço
  credit_card_transaction_fee: number, // Taxa cartão
  cross_border_tax: number,          // Imposto cross-border (se aplicável)
  final_shipping_fee: number,        // Frete final
  actual_shipping_fee: number,       // Frete real cobrado
  shipping_fee_rebate_from_shopee: number, // Subsídio frete Shopee
  seller_rebate: number,             // Rebate ao seller
  coin: number,                      // Moedas Shopee usadas
  voucher_from_shopee: number,       // Voucher pago pela Shopee
  voucher_from_seller: number,       // Voucher pago pelo seller
  credit_card_promotion: number,     // Promoção cartão
  shopee_kredit: number,             // Crédito Shopee do buyer
  seller_coin_cash_back: number,     // Cashback em moedas
  seller_return_refund_amount: number, // Reembolso ao buyer
  reverse_shipping_fee: number,      // Frete reverso (devolução)
  escrow_tax: number,                // Imposto sobre escrow
  withholding_tax: number,           // Imposto retido na fonte
  // ... possíveis campos adicionais por região
}
```

**get_escrow_list params [C]:**
- release_time_from / release_time_to: período de liberação
- Útil para buscar em lote por período

**get_wallet_transaction_list [C/I]:**
- create_time_from / create_time_to
- Retorna transações com: transaction_id, amount, transaction_type, status, create_time
- transaction_type pode incluir [?]: ORDER_INCOME, ADS_SPEND, WITHDRAWAL, REFUND, ADJUSTMENT
- Pode ou não vincular order_sn por transação [? — TESTAR NO SANDBOX]

### 3.3 Returns (Devoluções) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/returns/get_return_list | GET | Lista devoluções por período |
| /api/v2/returns/get_return_detail | GET | Detalhe de devolução específica |
| /api/v2/returns/confirm | POST | Confirmar devolução |
| /api/v2/returns/dispute | POST | Disputar devolução |

Campos: return_sn, order_sn, status, reason, refund_amount, create_time, update_time

### 3.4 Logistics (Logística) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/logistics/get_shipping_parameter | GET | Parâmetros de envio |
| /api/v2/logistics/ship_order | POST | Marcar como enviado |
| /api/v2/logistics/get_tracking_number | GET | Obter código de rastreio |
| /api/v2/logistics/get_tracking_info | GET | Info de tracking |
| /api/v2/logistics/download_shipping_document | POST | Baixar etiqueta |

### 3.5 Product (Produtos) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/product/get_item_list | GET | Lista de produtos |
| /api/v2/product/get_item_base_info | GET | Info básica do produto |
| /api/v2/product/get_item_extra_info | GET | Info extra |
| /api/v2/product/update_price | POST | Atualizar preço |
| /api/v2/product/update_stock | POST | Atualizar estoque |
| /api/v2/product/add_item | POST | Criar produto |
| /api/v2/product/update_item | POST | Editar produto |
| /api/v2/product/unlist_item | POST | Deslistar |

### 3.6 Shop (Loja) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/shop/get_shop_info | GET | Info da loja |
| /api/v2/shop/get_profile | GET | Perfil da loja |
| /api/v2/shop/update_profile | POST | Atualizar perfil |

### 3.7 Ads (Anúncios) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/ads/get_all_cpc_ads_daily_performance | GET | Gasto Ads diário por loja |
| /api/v2/ads/get_product_campaign_daily_performance | GET | Gasto por campanha/produto |
| /api/v2/ads/get_total_balance | GET | Saldo conta Ads |

**IMPORTANTE:** Ads são por PERÍODO, nunca por pedido. Não tentar vincular gasto Ads a order_sn.

### 3.8 Discount / Voucher / Marketing [C]

| Módulo | Descrição |
|--------|-----------|
| Discount | CRUD promoções |
| Voucher | CRUD cupons |
| Bundle Deal | Combos |
| Add-On Deal | Produtos complementares |
| Top Picks | Vitrines |
| Follow Prize | Premiação por follow |

### 3.9 Push Mechanism (Webhooks) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/push/set_app_push_config | POST | Configurar callback URL e eventos |
| /api/v2/push/get_app_push_config | GET | Ver configuração atual |

**Eventos de push disponíveis [C]:**
- order_status_push — mudança de status de pedido
- order_trackingno_push — tracking number atualizado
- package_fulfillment_status_push — status de fulfillment
- reserved_stock_change_push — estoque reservado mudou
- video_upload_push — upload de vídeo concluído
- brand_register_result — resultado de registro de marca

**Validação de webhook [I]:**
- Header: x-shopee-signature
- Validar: HMAC-SHA256(partner_key, url + "|" + body) == x-shopee-signature
- Sempre responder HTTP 200 rapidamente

### 3.10 Account Health [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/account_health/shop_performance | GET | Métricas de performance |
| /api/v2/account_health/shop_penalty | GET | Penalidades |

### 3.11 Income Report (Relatório Oficial) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/payment/generate_income_report | POST | Solicitar geração (assíncrono) |
| /api/v2/payment/get_income_report | GET | Baixar relatório gerado |

Útil como "verdade contábil" para auditoria semanal.

### 3.12 Public (Sem auth) [C]

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| /api/v2/public/get_shops_by_partner | GET | Lojas autorizadas |
| /api/v2/public/get_shopee_ip_ranges | GET | IPs da Shopee (whitelist) |

---

## 4. LIMITAÇÕES E CUIDADOS

### Rate Limits [?]
- Estimativa: ~100 requests/minuto (não confirmado oficialmente)
- Implementar throttling conservador: 1-2 req/s
- HTTP 429 = rate limit atingido → exponential backoff

### Janela temporal [I]
- get_order_list: máximo ~15 dias por chamada
- Backfill histórico: varrer em janelas encadeadas de 14 dias
- get_escrow_detail: por order_sn (sem limite de janela, mas respeitar rate limit)

### Token [C]
- access_token expira em 4h → refresh proativo a cada 3h
- refresh_token expira em 30 dias → refresh diário recomendado
- Cada shop_id tem seu próprio par de tokens
- Se refresh_token expirar (30d sem uso) → re-autorização manual necessária

### Dados [I]
- PII do buyer parcialmente mascarada (nome, telefone)
- Escrow detail pode não estar disponível para pedidos muito antigos [?]
- Campos podem variar por região (BR vs SEA) [?]
- Split orders: cada sub-pacote pode ter order_sn diferente [?]

### Webhook [I]
- Sem garantia de entrega única → implementar idempotência
- Sempre usar polling como backup (a cada 5-10 min)
- Dedupe por: (shop_id, order_sn, status, timestamp)

---

## 5. CHAVE DE CONCILIAÇÃO TINY ↔ SHOPEE

```
Tiny.numero_pedido_ecommerce = Shopee.order_sn
```

- Normalizar ambos (trim, uppercase) antes de comparar
- order_sn é string (ex: "2112132KAD867D")
- Verificar formato exato armazenado no Tiny [? — validar]

---

## 6. FLUXO FINANCEIRO DO PEDIDO

```
1. Buyer paga → dinheiro vai para ESCROW Shopee (não para seller)
2. Seller envia produto
3. Buyer confirma recebimento OU prazo automático expira (7 dias BR [I])
4. Pedido vira COMPLETED
5. Shopee libera escrow → dinheiro entra na CARTEIRA do seller
6. Seller pode sacar para conta bancária
```

**Marco para "prazo de pagamento":**
- Início: order_status = COMPLETED
- Fim: transação de escrow_release na wallet
- SLA estimado BR: 2-7 dias úteis após COMPLETED [I]

---

## 7. STATUS DE CONCILIAÇÃO (14 estados)

| Status | Condição |
|--------|----------|
| AGUARDANDO_ENVIO | Shopee: READY_TO_SHIP |
| EM_TRANSITO | Shopee: SHIPPED |
| ENTREGUE_AGUARDANDO_CONFIRMACAO | SHIPPED + delivery confirmada + age < 7d |
| AGUARDANDO_LIBERACAO | COMPLETED + escrow não creditado + dentro do SLA |
| PAGO_OK | Escrow creditado + valor bate |
| PAGO_COM_DIVERGENCIA | Escrow creditado + valor difere |
| ATRASO_DE_REPASSE | COMPLETED + age > SLA + sem release |
| DEVOLVIDO | Return ativo vinculado |
| REEMBOLSADO_PARCIAL | Refund parcial |
| EM_DISPUTA | Return em dispute |
| CANCELADO | Status CANCELLED |
| SEM_VINCULO_FINANCEIRO | Tiny tem, Shopee não tem |
| ORFAO_SHOPEE | Shopee tem, Tiny não tem |
| DADOS_INSUFICIENTES | Escrow não consultado ainda |

---

## 8. O QUE NÃO EXISTE NA API

- ❌ Gasto Ads por pedido individual (só por período/campanha)
- ❌ Gasto Afiliados por pedido (endpoint não confirmado [?])
- ❌ Custo do produto / CMV (vem do Tiny/ERP)
- ❌ Dados de cliente para CRM (PII mascarada)
- ❌ Reviews/avaliações via API v2 (não confirmado)
- ❌ Relatórios consolidados de BI (construir localmente)
- ❌ Margem contábil real (precisa de fontes externas)
- ❌ Antecipação de recebíveis (dado bancário, não Shopee)

---

## 9. PONTOS QUE PRECISAM TESTE NO SANDBOX

1. [?] get_wallet_transaction_list retorna order_sn por transação?
2. [?] get_wallet_transaction_list tem transaction_type para Ads, Affiliates, escrow_release?
3. [?] get_escrow_detail funciona para pedidos antigos (6+ meses)?
4. [?] Quais campos exatos o escrow retorna para pedidos BR?
5. [?] Rate limit real (requests/minuto)?
6. [?] get_payout_detail — existe e retorna o quê?
7. [?] Webhook order_status_push envia evento para COMPLETED?
8. [?] Split orders — escrow retorna por order_sn filho?
9. [?] Latência entre COMPLETED e wallet transaction aparecer?
10. [?] Income Report — formato e campos disponíveis?
11. [?] Saldo bloqueado vs disponível na wallet?
12. [?] Formato exato do order_sn armazenado no Tiny?

---

## 10. ARQUITETURA DE SYNC RECOMENDADA

| Rotina | Frequência | Endpoint |
|--------|------------|----------|
| Refresh token | A cada 3h (proativo) | auth/access_token/get |
| Sync pedidos | Webhook + polling 5min | order/get_order_list + get_order_detail |
| Escrow on COMPLETED | Trigger interno | payment/get_escrow_detail |
| Wallet transactions | A cada 30-60min | payment/get_wallet_transaction_list |
| Returns | A cada 15-30min | returns/get_return_list |
| Ads daily | Diário 04:00 | ads/get_all_cpc_ads_daily_performance |
| Income Report | Semanal | payment/generate_income_report → get_income_report |
| Reconciliação | A cada 15min | Interno (cruzamento de tabelas) |
| Backfill histórico | Sob demanda | Janelas de 14 dias, throttled |

**Deduplicação:** Chave natural (shop_id, order_sn) para pedidos/escrow. UPSERT sempre.
**Idempotência:** Job de reconciliação pode rodar N vezes sem efeito colateral.
**Reprocessamento:** Job noturno reprocessa últimos 30 dias para capturar mudanças tardias.
