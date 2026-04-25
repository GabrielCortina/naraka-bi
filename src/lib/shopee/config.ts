// Configuração centralizada da integração Shopee Open Platform (API v2).
// Referência técnica: SHOPEE_API_REFERENCE.md
//
// Multi-app (migration 057_shopee_apps): cada partner_id é um app distinto
// com seu próprio partner_key. As credenciais ficam em `shopee_apps`. Os
// helpers `getShopeeConfigByPartnerId` / `getShopeeConfigForShop` resolvem
// dinamicamente; o helper sync `getShopeeConfig()` continua lendo env vars
// e serve de fallback (compatibilidade pra cron/jobs antigos e ambiente
// de dev sem migration aplicada).

import { createServiceClient } from '@/lib/supabase-server';

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
  // Origem da config — útil em logs (ex: "env" vs "shopee_apps:Joy").
  source?: string;
}

// .trim() defensivo: whitespace/newline invisível no .env quebra o HMAC silenciosamente
// (sign do partner_id/partner_key entra no base_string byte-a-byte).
export function getShopeeConfig(): ShopeeConfig {
  return {
    partnerId: (process.env.SHOPEE_PARTNER_ID ?? '').trim(),
    partnerKey: (process.env.SHOPEE_PARTNER_KEY ?? '').trim(),
    redirectUrl: (process.env.SHOPEE_REDIRECT_URL ?? '').trim(),
    isProduction: (process.env.SHOPEE_IS_PRODUCTION ?? '').trim() === 'true',
    source: 'env',
  };
}

// Host para endpoints de OAuth (shop/auth_partner, auth/token/get, auth/access_token/get).
export function getShopeeAuthHost(cfg: ShopeeConfig = getShopeeConfig()): string {
  return cfg.isProduction ? PRODUCTION_AUTH_HOST : SANDBOX_AUTH_HOST;
}

// Host para TODAS as chamadas autenticadas /api/v2/* (order, payment, logistics, ...).
export function getShopeeApiHost(cfg: ShopeeConfig = getShopeeConfig()): string {
  return cfg.isProduction ? PRODUCTION_API_HOST : SANDBOX_API_HOST;
}

export function assertShopeeConfig(cfg: ShopeeConfig = getShopeeConfig()): void {
  if (!cfg.partnerId || !cfg.partnerKey || !cfg.redirectUrl) {
    throw new Error(
      'Shopee config incompleta: defina SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY e SHOPEE_REDIRECT_URL ou cadastre o app em shopee_apps',
    );
  }
}

// ============================================================
// Multi-app: lookup em shopee_apps com cache em memória
// ============================================================

interface ShopeeAppRow {
  partner_id: number;
  partner_key: string;
  redirect_url: string;
  is_production: boolean | null;
  label: string;
}

// Cache vive por instância (lambda) — TTL não é necessário porque mudanças
// em shopee_apps são raras; reciclar a função invalida o cache.
const partnerIdCache = new Map<number, ShopeeConfig>();
const labelCache = new Map<string, ShopeeConfig>();
const shopIdCache = new Map<number, ShopeeConfig>();

function appRowToConfig(row: ShopeeAppRow): ShopeeConfig {
  return {
    partnerId: String(row.partner_id),
    partnerKey: row.partner_key,
    redirectUrl: row.redirect_url,
    isProduction: row.is_production ?? true,
    source: `shopee_apps:${row.label}`,
  };
}

export async function getShopeeConfigByPartnerId(
  partnerId: number | string,
): Promise<ShopeeConfig> {
  const id = Number(partnerId);
  if (!Number.isFinite(id)) {
    throw new Error(`partner_id inválido: ${partnerId}`);
  }

  const cached = partnerIdCache.get(id);
  if (cached) return cached;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shopee_apps')
    .select('partner_id, partner_key, redirect_url, is_production, label')
    .eq('partner_id', id)
    .eq('ativo', true)
    .maybeSingle();

  if (!error && data) {
    const cfg = appRowToConfig(data as unknown as ShopeeAppRow);
    partnerIdCache.set(id, cfg);
    return cfg;
  }

  // Fallback: env vars, se o partner_id casar com o do .env.
  const env = getShopeeConfig();
  if (env.partnerId && Number(env.partnerId) === id) {
    return env;
  }

  throw new Error(`Shopee app não encontrado para partner_id=${id}`);
}

export async function getShopeeConfigByLabel(
  label: string,
): Promise<ShopeeConfig> {
  const key = label.trim().toLowerCase();
  const cached = labelCache.get(key);
  if (cached) return cached;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shopee_apps')
    .select('partner_id, partner_key, redirect_url, is_production, label')
    .ilike('label', label)
    .eq('ativo', true)
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Shopee app não encontrado para label='${label}'`);
  }

  const cfg = appRowToConfig(data as unknown as ShopeeAppRow);
  labelCache.set(key, cfg);
  partnerIdCache.set(Number(cfg.partnerId), cfg);
  return cfg;
}

// Resolve a config a partir do shop_id: lê shopee_tokens.partner_id e
// devolve o app correspondente. Cai pra env se a loja ainda não tem
// linha em shopee_tokens (caso de bootstrap inicial).
export async function getShopeeConfigForShop(
  shopId: number | string,
): Promise<ShopeeConfig> {
  const id = Number(shopId);
  if (!Number.isFinite(id)) {
    throw new Error(`shop_id inválido: ${shopId}`);
  }

  const cached = shopIdCache.get(id);
  if (cached) return cached;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_tokens')
    .select('partner_id')
    .eq('shop_id', id)
    .maybeSingle();

  let cfg: ShopeeConfig;
  if (data?.partner_id) {
    cfg = await getShopeeConfigByPartnerId(Number(data.partner_id));
  } else {
    const env = getShopeeConfig();
    assertShopeeConfig(env);
    cfg = env;
  }

  shopIdCache.set(id, cfg);
  return cfg;
}

// Útil para testes / quando shopee_apps muda em runtime.
export function clearShopeeConfigCache(): void {
  partnerIdCache.clear();
  labelCache.clear();
  shopIdCache.clear();
}
