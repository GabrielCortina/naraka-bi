// Configuração centralizada da integração Shopee Open Platform (API v2).
// Referência técnica: SHOPEE_API_REFERENCE.md

// Em produção BR, OAuth e chamadas /api/v2/* usam o MESMO host: openplatform.shopee.com.br.
// Histórico: tokens emitidos por `partner.shopeemobile.com` (host global SEA) foram
// rejeitados por `openplatform.shopee.com.br` com "invalid access_token" — a Shopee
// separa a base de tokens por região, então o token só é aceito no host que o emitiu.
// Fallback: se emissão falhar em openplatform.shopee.com.br, testar partner.shopeemobile.com
// (mas nesse caso as chamadas /api/v2/* também precisam ir para o mesmo host).
// No sandbox os dois fluxos também usam o mesmo host.
const SANDBOX_AUTH_HOST = 'https://openplatform.sandbox.test-stable.shopee.sg';
const SANDBOX_API_HOST = 'https://openplatform.sandbox.test-stable.shopee.sg';
const PRODUCTION_AUTH_HOST = 'https://openplatform.shopee.com.br';
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
