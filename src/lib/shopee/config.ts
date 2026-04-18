// Configuração centralizada da integração Shopee Open Platform (API v2).
// Referência técnica: SHOPEE_API_REFERENCE.md

const SANDBOX_HOST = 'https://partner.test-stable.shopeemobile.com';
const PRODUCTION_HOST = 'https://partner.shopeemobile.com';

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

export function getShopeeHost(): string {
  return getShopeeConfig().isProduction ? PRODUCTION_HOST : SANDBOX_HOST;
}

export function assertShopeeConfig(cfg: ShopeeConfig = getShopeeConfig()): void {
  if (!cfg.partnerId || !cfg.partnerKey || !cfg.redirectUrl) {
    throw new Error(
      'Shopee config incompleta: defina SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_REDIRECT_URL',
    );
  }
}
