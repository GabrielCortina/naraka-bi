import { getShopeeConfig, getShopeeHost, assertShopeeConfig } from './config';
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
export async function shopeeApiCall<T = unknown>(
  path: string,
  params: Record<string, unknown>,
  shopId: number | string,
  accessToken: string,
  method: 'GET' | 'POST' = 'GET',
): Promise<ShopeeApiResponse<T>> {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopPath(path, timestamp, accessToken, shopId);

  const commonParams = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  });

  let url = `${getShopeeHost()}${path}?${commonParams.toString()}`;
  let body: string | undefined;

  if (method === 'GET') {
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      url += `&${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`;
    }
  } else {
    body = JSON.stringify(params);
  }

  const res = await fetch(url, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body,
    cache: 'no-store',
  });

  const json = (await res.json()) as ShopeeApiResponse<T>;

  if (!res.ok || json?.error) {
    console.error(`[shopee-client] ${method} ${path} falhou:`, {
      status: res.status,
      error: json?.error,
      message: json?.message,
      request_id: json?.request_id,
    });
    throw new Error(
      `Shopee ${path}: ${json?.error || res.statusText}${json?.message ? ' — ' + json.message : ''}`,
    );
  }

  return json;
}
