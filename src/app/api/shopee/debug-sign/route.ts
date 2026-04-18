import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { getShopeeConfig, getShopeeHost } from '@/lib/shopee/config';

// TEMPORÁRIO: diagnóstico do cálculo do sign para OAuth auth_partner.
// Remover após resolver o "Wrong sign".
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface SignVariants {
  v1_key_as_string: string;          // Método oficial: partner_key como string literal
  v2_hex_decoded_without_prefix: string; // Hipótese: remove "shpk" e trata os 60 chars como hex
  v3_without_prefix_as_string: string;   // Hipótese: só remove "shpk", resto como string
}

function hmac(key: string | Buffer, message: string): string {
  return createHmac('sha256', key).update(message).digest('hex');
}

export async function GET() {
  const cfg = getShopeeConfig();

  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const baseString = `${cfg.partnerId}${path}${timestamp}`;

  const key = cfg.partnerKey;
  const keyWithoutPrefix = key.startsWith('shpk') ? key.slice(4) : key;

  let v2HexKeyBytes: Buffer | null = null;
  let v2Error: string | null = null;
  try {
    if (/^[0-9a-fA-F]+$/.test(keyWithoutPrefix) && keyWithoutPrefix.length % 2 === 0) {
      v2HexKeyBytes = Buffer.from(keyWithoutPrefix, 'hex');
    } else {
      v2Error = 'resto após shpk não é hex válido ou length ímpar';
    }
  } catch (err) {
    v2Error = err instanceof Error ? err.message : 'hex parse error';
  }

  const signs: SignVariants = {
    v1_key_as_string: hmac(key, baseString),
    v2_hex_decoded_without_prefix: v2HexKeyBytes
      ? hmac(v2HexKeyBytes, baseString)
      : `(skipped: ${v2Error})`,
    v3_without_prefix_as_string: hmac(keyWithoutPrefix, baseString),
  };

  const host = getShopeeHost();
  const redirectEncoded = encodeURIComponent(cfg.redirectUrl);

  // URL montada com a variante oficial (v1)
  const fullUrl =
    `${host}${path}?partner_id=${cfg.partnerId}` +
    `&timestamp=${timestamp}` +
    `&sign=${signs.v1_key_as_string}` +
    `&redirect=${redirectEncoded}`;

  return NextResponse.json({
    // Env diagnostics
    env: {
      SHOPEE_PARTNER_ID_raw: process.env.SHOPEE_PARTNER_ID,
      SHOPEE_PARTNER_ID_has_whitespace:
        process.env.SHOPEE_PARTNER_ID !== (process.env.SHOPEE_PARTNER_ID ?? '').trim(),
      SHOPEE_PARTNER_KEY_length_raw: (process.env.SHOPEE_PARTNER_KEY ?? '').length,
      SHOPEE_PARTNER_KEY_has_whitespace:
        process.env.SHOPEE_PARTNER_KEY !== (process.env.SHOPEE_PARTNER_KEY ?? '').trim(),
      SHOPEE_IS_PRODUCTION_raw: process.env.SHOPEE_IS_PRODUCTION,
      SHOPEE_REDIRECT_URL_raw: process.env.SHOPEE_REDIRECT_URL,
    },

    // Partner ID
    partner_id: cfg.partnerId,
    partner_id_type: typeof cfg.partnerId,
    partner_id_length: cfg.partnerId.length,

    // Path / timestamp
    path,
    timestamp,

    // Base string
    base_string: baseString,
    base_string_length: baseString.length,

    // Partner key fingerprint
    partner_key_first4: key.slice(0, 4),
    partner_key_last4: key.slice(-4),
    partner_key_length: key.length,
    partner_key_has_shpk_prefix: key.startsWith('shpk'),
    partner_key_without_prefix_length: keyWithoutPrefix.length,
    partner_key_without_prefix_is_hex:
      /^[0-9a-fA-F]+$/.test(keyWithoutPrefix) && keyWithoutPrefix.length % 2 === 0,

    // Sign (3 variantes para teste empírico)
    sign: signs.v1_key_as_string,
    sign_length: signs.v1_key_as_string.length,
    sign_variants: signs,

    // Host / environment
    host,
    is_production: cfg.isProduction,

    // Redirect URL
    redirect_url_raw: cfg.redirectUrl,
    redirect_url_encoded: redirectEncoded,

    // URL completa (usando v1)
    full_url: fullUrl,

    // URLs alternativas com as outras variantes (para teste manual no browser)
    full_url_v2: v2HexKeyBytes
      ? `${host}${path}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${signs.v2_hex_decoded_without_prefix}&redirect=${redirectEncoded}`
      : null,
    full_url_v3:
      `${host}${path}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${signs.v3_without_prefix_as_string}&redirect=${redirectEncoded}`,
  });
}
