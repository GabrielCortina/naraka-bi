# Tiny ERP API v3 — Referência para Integração de Pedidos

Base URL: `https://api.tiny.com.br/public-api/v3`

---

## 1. Autenticação (OAuth 2)

### Autorização

Redirecionar o usuário para:

```
https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&scope=openid&response_type=code
```

### Obter Token de Acesso

**POST** `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`

Body (`x-www-form-urlencoded`):

| Campo           | Valor                |
|-----------------|----------------------|
| grant_type      | authorization_code   |
| client_id       | CLIENT_ID            |
| client_secret   | CLIENT_SECRET        |
| redirect_uri    | REDIRECT_URI         |
| code            | AUTHORIZATION_CODE   |

### Usar o Token

```
Authorization: Bearer {access_token}
```

- **Token expira em:** 4 horas
- **Refresh token expira em:** 1 dia

### Renovar Token

**POST** `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`

Body (`x-www-form-urlencoded`):

| Campo           | Valor           |
|-----------------|-----------------|
| grant_type      | refresh_token   |
| client_id       | CLIENT_ID       |
| client_secret   | CLIENT_SECRET   |
| refresh_token   | REFRESH_TOKEN   |

---

## 2. Rate Limit

- Limite por **minuto**, compartilhado por **conta** (não por app)
- GET tem limite maior que POST/PUT/DELETE
- Headers de controle:

| Header                 | Descrição                        |
|------------------------|----------------------------------|
| X-RateLimit-Limit      | Limite total por minuto          |
| X-RateLimit-Remaining  | Restante no minuto atual         |
| X-RateLimit-Reset      | Segundos para reset              |

---

## 3. Listar Pedidos

**GET** `/pedidos`

### Query Params

| Param                    | Tipo      | Descrição                          |
|--------------------------|-----------|------------------------------------|
| situacao                 | enum      | Ver tabela de situações abaixo     |
| dataInicial              | string    | Filtro por data de criação         |
| dataFinal                | string    | Filtro por data de criação         |
| dataAtualizacao          | string    | Filtro por data de atualização     |
| numeroPedidoEcommerce    | string    | Número do pedido no e-commerce     |
| nomeCliente              | string    | Nome do cliente                    |
| cpfCnpj                  | string    | CPF ou CNPJ                       |
| numero                   | integer   | Número do pedido                   |
| codigoCliente            | string    | Código do cliente                  |
| idVendedor               | integer   | ID do vendedor                     |
| marcadores               | string[]  | Marcadores                         |
| origemPedido             | enum      | 0=Pedido de Venda, 1=PDV           |
| orderBy                  | enum      | `asc` \| `desc`                    |
| limit                    | integer   | Default: 100                       |
| offset                   | integer   | Default: 0                         |

### Enum `situacao`

| Valor | Descrição          |
|-------|--------------------|
| 8     | Dados Incompletos  |
| 0     | Aberta             |
| 3     | Aprovada           |
| 4     | Preparando Envio   |
| 1     | Faturada           |
| 7     | Pronto Envio       |
| 5     | Enviada            |
| 6     | Entregue           |
| 2     | Cancelada          |
| 9     | Nao Entregue       |

### Response 200

```json
{
  "itens": [
    {
      "id": 123,
      "situacao": 0,
      "numeroPedido": "1001",
      "ecommerce": {},
      "dataCriacao": "2025-01-01T00:00:00",
      "dataPrevista": "2025-01-05",
      "cliente": {},
      "valor": 150.00,
      "vendedor": {},
      "transportador": {},
      "origemPedido": 0
    }
  ],
  "paginacao": {
    "limit": 100,
    "offset": 0,
    "total": 1
  }
}
```

---

## 4. Obter Pedido (Full)

**GET** `/pedidos/{idPedido}`

| Path Param | Tipo    | Obrigatório |
|------------|---------|-------------|
| idPedido   | integer | Sim         |

### Response 200 — Campos Completos

```json
{
  "id": 123,
  "numeroPedido": "1001",
  "idNotaFiscal": 456,
  "dataFaturamento": "2025-01-02",

  "valorTotalProdutos": 100.00,
  "valorTotalPedido": 150.00,
  "valorDesconto": 0,
  "valorFrete": 50.00,
  "valorOutrasDespesas": 0,

  "situacao": 0,
  "data": "2025-01-01",
  "dataEntrega": "2025-01-05",
  "dataPrevista": "2025-01-05",
  "dataEnvio": "2025-01-03",

  "observacoes": "",
  "observacoesInternas": "",
  "numeroOrdemCompra": "",
  "origemPedido": 0,

  "cliente": {
    "id": 1,
    "nome": "João Silva",
    "codigo": "CLI001",
    "fantasia": "",
    "tipoPessoa": "F",
    "cpfCnpj": "12345678900",
    "inscricaoEstadual": "",
    "rg": "",
    "telefone": "",
    "celular": "",
    "email": "joao@email.com",
    "endereco": {}
  },

  "enderecoEntrega": {
    "endereco": "Rua Exemplo",
    "numero": "100",
    "complemento": "",
    "bairro": "Centro",
    "municipio": "São Paulo",
    "cep": "01000-000",
    "uf": "SP",
    "pais": "Brasil",
    "nomeDestinatario": "João Silva",
    "cpfCnpj": "12345678900",
    "tipoPessoa": "F",
    "telefone": "",
    "inscricaoEstadual": ""
  },

  "ecommerce": {
    "id": 1,
    "nome": "Minha Loja",
    "numeroPedidoEcommerce": "EC-1001",
    "numeroPedidoCanalVenda": "CV-1001",
    "canalVenda": "marketplace"
  },

  "transportador": {
    "id": 1,
    "nome": "Transportadora X",
    "fretePorConta": "R",
    "formaEnvio": "Sedex",
    "formaFrete": "N",
    "codigoRastreamento": "BR123456789",
    "urlRastreamento": "https://rastreamento.exemplo.com/BR123456789"
  },

  "deposito": {
    "id": 1,
    "nome": "Depósito Principal"
  },

  "vendedor": {
    "id": 1,
    "nome": "Maria Vendedora"
  },

  "naturezaOperacao": {
    "id": 1,
    "nome": "Venda de Mercadoria"
  },

  "intermediador": {
    "id": 1,
    "nome": "Intermediador Y",
    "cnpj": "00000000000100",
    "cnpjPagamentoInstituicao": "00000000000200"
  },

  "listaPreco": {
    "id": 1,
    "nome": "Lista Padrão",
    "acrescimoDesconto": 0
  },

  "pagamento": {
    "formaRecebimento": "Cartão",
    "meioPagamento": "Crédito",
    "condicaoPagamento": "30 dias",
    "parcelas": []
  },

  "itens": [
    {
      "produto": {
        "id": 1,
        "sku": "PROD-001",
        "descricao": "Produto Exemplo",
        "tipo": "P"
      },
      "quantidade": 2,
      "valorUnitario": 50.00,
      "infoAdicional": ""
    }
  ],

  "pagamentosIntegrados": [
    {
      "valor": 150.00,
      "tipoPagamento": "Crédito",
      "cnpjIntermediador": "00000000000100",
      "codigoAutorizacao": "AUTH123",
      "codigoBandeira": "VISA"
    }
  ]
}
```

---

## 5. Estratégia de Polling (para "tempo real")

A API Tiny **NÃO** tem webhooks de pedidos. Use polling com `dataAtualizacao`:

1. A cada N minutos, chamar:
   ```
   GET /pedidos?dataAtualizacao={ultimaVerificacao}&orderBy=asc
   ```
2. Para cada pedido retornado na listagem, chamar `GET /pedidos/{id}` para obter dados completos.
3. Respeitar `X-RateLimit-Remaining` antes de cada chamada.
4. Salvar o timestamp da última verificação no banco.
