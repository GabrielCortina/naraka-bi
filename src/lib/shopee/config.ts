// Configuração centralizada da integração Shopee Open Platform (API v2).
// Referência técnica: SHOPEE_API_REFERENCE.md

// Host oficial do sandbox confirmado via API Test Tool da Shopee.
// NÃO usar partner.test-stable.shopeemobile.com (documentado errado em vários lugares).
const SANDBOX_HOST = 'https://openplatform.sandbox.test-stable.shopee.sg';
// Produção: host documentado oficialmente. No sandbox o host documentado estava errado
// (era openplatform.sandbox.test-stable.shopee.sg, não partner.test-stable.shopeemobile.com),
// então se em produção aparecer "Wrong sign" mesmo com assinatura correta, testar o alternativo
// https://openplatform.shopee.com antes de investigar o HMAC.
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
