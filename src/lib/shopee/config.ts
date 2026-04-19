// Configuração centralizada da integração Shopee Open Platform (API v2).
// Referência técnica: SHOPEE_API_REFERENCE.md

// A Shopee usa hosts DIFERENTES para OAuth e para chamadas de API em produção BR:
//   • OAuth (auth_partner, auth/token/get, auth/access_token/get) → partner.shopeemobile.com
//   • Chamadas autenticadas /api/v2/* (BR)                         → openplatform.shopee.com.br
// Usar o host de API para OAuth → não emite o redirect de autorização.
// Usar o host de OAuth para chamadas API em BR → HTTP 404 "page not found".
// No sandbox os dois fluxos usam o MESMO host.
const SANDBOX_AUTH_HOST = 'https://openplatform.sandbox.test-stable.shopee.sg';
const SANDBOX_API_HOST = 'https://openplatform.sandbox.test-stable.shopee.sg';
const PRODUCTION_AUTH_HOST = 'https://partner.shopeemobile.com';
const PRODUCTION_API_HOST = 'https://openplatform.shopee.com.br';

export interface ShopeeConfig {
  partnerId: string;
  partnerKey: string;
  redirectUrl: string;
  isProduction: boolean;
}

// .trim() defensivo: whitespace/newline invisível no .env quebra o HMAC silenciosamente
// (sign do partner_id/partner_key entra no base_string byte-a-byte).
export function getShopeeConfig(): ShopeeConfig {
  return {
    partnerId: (process.env.SHOPEE_PARTNER_ID ?? '').trim(),
    partnerKey: (process.env.SHOPEE_PARTNER_KEY ?? '').trim(),
    redirectUrl: (process.env.SHOPEE_REDIRECT_URL ?? '').trim(),
    isProduction: (process.env.SHOPEE_IS_PRODUCTION ?? '').trim() === 'true',
  };
}

// Host para endpoints de OAuth (shop/auth_partner, auth/token/get, auth/access_token/get).
export function getShopeeAuthHost(): string {
  return getShopeeConfig().isProduction ? PRODUCTION_AUTH_HOST : SANDBOX_AUTH_HOST;
}

// Host para TODAS as chamadas autenticadas /api/v2/* (order, payment, logistics, ...).
export function getShopeeApiHost(): string {
  return getShopeeConfig().isProduction ? PRODUCTION_API_HOST : SANDBOX_API_HOST;
}

export function assertShopeeConfig(cfg: ShopeeConfig = getShopeeConfig()): void {
  if (!cfg.partnerId || !cfg.partnerKey || !cfg.redirectUrl) {
    throw new Error(
      'Shopee config incompleta: defina SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_REDIRECT_URL',
    );
  }
}
