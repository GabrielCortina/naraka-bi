import {
  getShopeeApiHost,
  assertShopeeConfig,
  getShopeeConfigForShop,
  type ShopeeConfig,
} from './config';
import { signShopPath } from './auth';

export interface ShopeeApiResponse<T = unknown> {
  error?: string;
  message?: string;
  request_id?: string;
  response?: T;
  [key: string]: unknown;
}

// Cliente genérico para endpoints autenticados da Shopee v2 (ref §2).
// - timestamp em SEGUNDOS
// - query string carrega os commonParams (partner_id, timestamp, access_token, shop_id, sign)
// - GET: params extras na query; POST: params no body JSON
//
// Multi-app (migration 057_shopee_apps): se `cfg` não for passado, resolvemos
// pelo shop_id (via shopee_tokens.partner_id → shopee_apps). Sem isso, syncs
// de lojas de partners diferentes do .env falham com "invalid_partner".
// Callers que já têm a cfg em mãos (sync-helpers) devem passar — evita um
// roundtrip extra por chamada.
export async function shopeeApiCall<T = unknown>(
  path: string,
  params: Record<string, unknown>,
  shopId: number | string,
  accessToken: string,
  method: 'GET' | 'POST' = 'GET',
  cfg?: ShopeeConfig,
): Promise<ShopeeApiResponse<T>> {
  const c = cfg ?? await getShopeeConfigForShop(shopId);
  assertShopeeConfig(c);

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopPath(path, timestamp, accessToken, shopId, c);

  const commonParams = new URLSearchParams({
    partner_id: c.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  });

  let url = `${getShopeeApiHost(c)}${path}?${commonParams.toString()}`;
  let body: string | undefined;

  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
    }
  } else {
    body = JSON.stringify(params);
  }

  // Log da URL SEM partes sensíveis (access_token/sign). `path` e host bastam para diagnóstico.
  console.log(`[shopee-client] calling ${method} ${getShopeeApiHost(c)}${path} (partner=${c.source ?? 'env'})`);

  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body,
    cache: 'no-store',
  });

  // Capturamos como texto primeiro: se Shopee devolver HTML (host errado, 4xx/5xx do
  // proxy, etc.), res.json() dá "Unexpected non-whitespace character after JSON at
  // position N" e perdemos o corpo real do erro.
  const rawText = await res.text();
  console.log(
    `[shopee-client] ${method} ${path} status=${res.status} body(first 500)=`,
    rawText.substring(0, 500),
  );

  let json: ShopeeApiResponse<T>;
  try {
    json = JSON.parse(rawText) as ShopeeApiResponse<T>;
  } catch {
    throw new Error(
      `Shopee ${path}: resposta não-JSON (status ${res.status}). Body: ${rawText.substring(0, 200)}`,
    );
  }

  if (!res.ok || json?.error) {
    console.error(`[shopee-client] ${method} ${path} falhou:`, {
      status: res.status,
      error: json?.error,
      message: json?.message,
      request_id: json?.request_id,
    });
    throw new Error(
      `Shopee ${path}: HTTP ${res.status} ${json?.error || res.statusText}${json?.message ? ' — ' + json.message : ''}`,
    );
  }

  return json;
}
