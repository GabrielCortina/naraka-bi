import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopeeConfig, assertShopeeConfig } from '@/lib/shopee/config';
import { signShopPath } from '@/lib/shopee/auth';

// TEMPORÁRIO: testa a MESMA chamada /api/v2/shop/get_shop_info em 3 hosts
// diferentes usando o access_token atual do banco. Objetivo: determinar
// empiricamente qual host aceita os tokens emitidos. Remover após o diagnóstico.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HOSTS = [
  'https://partner.shopeemobile.com',
  'https://openplatform.shopee.com.br',
  'https://openplatform.shopee.com',
] as const;

interface HostResult {
  host: string;
  status: number | null;
  body: string;
  fetchError: string | null;
}

async function getAccessTokenForShop(shopId: number): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_tokens')
    .select('access_token, token_expires_at')
    .eq('shop_id', shopId)
    .single();

  if (!data) return null;
  if (new Date(data.token_expires_at).getTime() < Date.now()) return null;
  return data.access_token as string;
}

async function probe(host: string, path: string, query: string): Promise<HostResult> {
  try {
    const res = await fetch(`${host}${path}?${query}`, { method: 'GET', cache: 'no-store' });
    const text = await res.text();
    return { host, status: res.status, body: text.substring(0, 200), fetchError: null };
  } catch (err) {
    return {
      host,
      status: null,
      body: '',
      fetchError: err instanceof Error ? err.message : 'unknown',
    };
  }
}

// GET /api/shopee/test-hosts?shop_id=<n>
export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  if (!shopIdRaw) {
    return NextResponse.json({ error: 'query param shop_id é obrigatório' }, { status: 400 });
  }
  const shopId = Number(shopIdRaw);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  const accessToken = await getAccessTokenForShop(shopId);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Tokens não encontrados ou access_token expirado (faça refresh antes)' },
      { status: 404 },
    );
  }

  const cfg = getShopeeConfig();
  assertShopeeConfig(cfg);

  // Sign é host-independente (base_string = partner_id+path+ts+access_token+shop_id),
  // então a mesma query roda em todos os hosts — a única variável é o host em si.
  const path = '/api/v2/shop/get_shop_info';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopPath(path, timestamp, accessToken, shopId);

  const query = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
  }).toString();

  const results = await Promise.all(HOSTS.map(h => probe(h, path, query)));

  return NextResponse.json({
    shop_id: shopId,
    partner_id: cfg.partnerId,
    is_production: cfg.isProduction,
    path,
    method: 'GET',
    timestamp,
    tested_at: new Date().toISOString(),
    results,
  });
}
