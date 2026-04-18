import { NextRequest, NextResponse } from 'next/server';
import { getAccessToken } from '@/lib/shopee/auth';
import { shopeeApiCall } from '@/lib/shopee/client';
import { getShopeeConfig } from '@/lib/shopee/config';
import { createServiceClient } from '@/lib/supabase-server';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function buildRedirect(suffix: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${appUrl}/configuracoes/shopee${suffix}`;
}

interface ShopInfoResponse {
  shop_name?: string;
}

// GET /api/auth/shopee/callback
// Recebe o code e shop_id da Shopee, troca por tokens e persiste em shopee_tokens.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    console.error('[shopee-callback] Erro da Shopee:', error);
    return NextResponse.redirect(buildRedirect(`?error=${encodeURIComponent(error)}`));
  }

  if (!code || !shopIdRaw) {
    return NextResponse.redirect(buildRedirect('?error=missing_params'));
  }

  const shopId = Number(shopIdRaw);
  if (!Number.isFinite(shopId)) {
    return NextResponse.redirect(buildRedirect('?error=invalid_shop_id'));
  }

  try {
    const tokens = await getAccessToken(code, shopId);

    // Busca nome da loja (opcional — não bloqueia o fluxo se falhar)
    let shopName: string | null = null;
    try {
      const info = await shopeeApiCall<ShopInfoResponse>(
        '/api/v2/shop/get_shop_info',
        {},
        shopId,
        tokens.access_token,
        'GET',
      );
      shopName = (info.shop_name as string | undefined) ?? null;
    } catch (err) {
      console.warn('[shopee-callback] get_shop_info falhou (prosseguindo sem shop_name):', err);
    }

    const now = Date.now();
    const tokenExpiresAt = new Date(now + tokens.expire_in * 1000).toISOString();
    const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();

    const cfg = getShopeeConfig();
    const supabase = createServiceClient();
    const { error: dbError } = await supabase
      .from('shopee_tokens')
      .upsert(
        {
          shop_id: shopId,
          shop_name: shopName,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: tokenExpiresAt,
          refresh_expires_at: refreshExpiresAt,
          partner_id: Number(cfg.partnerId),
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_id' },
      );

    if (dbError) {
      console.error('[shopee-callback] Falha ao salvar tokens:', dbError);
      return NextResponse.redirect(buildRedirect('?error=db_save_failed'));
    }

    console.log(`[shopee-callback] Loja ${shopId} (${shopName ?? 'sem nome'}) conectada.`);
    return NextResponse.redirect(buildRedirect('?success=true'));
  } catch (err) {
    console.error('[shopee-callback] Erro:', err);
    const msg = err instanceof Error ? err.message : 'token_exchange_failed';
    return NextResponse.redirect(buildRedirect(`?error=${encodeURIComponent(msg)}`));
  }
}
