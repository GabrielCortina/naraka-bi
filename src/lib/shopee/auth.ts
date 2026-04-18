import { createHmac } from 'node:crypto';
import { getShopeeConfig, getShopeeHost, assertShopeeConfig } from './config';

// HMAC-SHA256 usado em toda assinatura Shopee (ref §2).
// base_string montado conforme o tipo de chamada:
//   - Endpoints públicos (auth): partner_id + path + timestamp
//   - Endpoints autenticados:    partner_id + path + timestamp + access_token + shop_id
function generateSign(baseString: string, partnerKey: string): string {
  return createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

export function signPublicPath(path: string, timestamp: number): string {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);
  return generateSign(`${cfg.partnerId}${path}${timestamp}`, cfg.partnerKey);
}

export function signShopPath(
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number | string,
): string {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);
  return generateSign(
    `${cfg.partnerId}${path}${timestamp}${accessToken}${shopId}`,
    cfg.partnerKey,
  );
}

// URL de autorização (ref §2) — válida por 5 minutos.
// Após o seller autorizar, Shopee redireciona para redirect_url com ?code=&shop_id=
export function getAuthUrl(): string {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);

  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicPath(path, timestamp);

  const params = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    sign,
    redirect: cfg.redirectUrl,
  });

  return `${getShopeeHost()}${path}?${params.toString()}`;
}

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id?: string;
  error?: string;
  message?: string;
}

// Troca o authorization code pelo primeiro par de tokens.
export async function getAccessToken(
  code: string,
  shopId: number | string,
): Promise<ShopeeTokenResponse> {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);

  const path = '/api/v2/auth/token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicPath(path, timestamp);

  const url =
    `${getShopeeHost()}${path}` +
    `?partner_id=${cfg.partnerId}` +
    `&timestamp=${timestamp}` +
    `&sign=${sign}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(cfg.partnerId),
    }),
    cache: 'no-store',
  });

  const json = (await res.json()) as ShopeeTokenResponse;

  if (!res.ok || json.error) {
    console.error('[shopee-auth] get_access_token falhou:', {
      status: res.status,
      error: json.error,
      message: json.message,
      request_id: json.request_id,
    });
    throw new Error(
      `Shopee get_access_token: ${json.error || res.statusText}${json.message ? ' — ' + json.message : ''}`,
    );
  }

  return json;
}

// Renova o par de tokens. CRÍTICO: refresh_token anterior é invalidado após sucesso —
// o chamador DEVE persistir o novo imediatamente.
export async function refreshAccessToken(
  refreshToken: string,
  shopId: number | string,
): Promise<ShopeeTokenResponse> {
  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);

  const path = '/api/v2/auth/access_token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signPublicPath(path, timestamp);

  const url =
    `${getShopeeHost()}${path}` +
    `?partner_id=${cfg.partnerId}` +
    `&timestamp=${timestamp}` +
    `&sign=${sign}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: refreshToken,
      shop_id: Number(shopId),
      partner_id: Number(cfg.partnerId),
    }),
    cache: 'no-store',
  });

  const json = (await res.json()) as ShopeeTokenResponse;

  if (!res.ok || json.error) {
    console.error('[shopee-auth] refresh_access_token falhou:', {
      status: res.status,
      error: json.error,
      message: json.message,
      request_id: json.request_id,
    });
    throw new Error(
      `Shopee refresh_access_token: ${json.error || res.statusText}${json.message ? ' — ' + json.message : ''}`,
    );
  }

  return json;
}
