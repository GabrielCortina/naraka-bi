import { NextRequest, NextResponse } from 'next/server';
import { shopeeApiCall } from '@/lib/shopee/client';
import { createServiceClient } from '@/lib/supabase-server';

// Rotas Shopee assinam com timestamp fresh — nunca podem ser cacheadas.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/shopee/test?shop_id=<number>
// Testa a conexão chamando GET /api/v2/shop/get_shop_info com os tokens salvos.
export async function GET(request: NextRequest) {
  try {
    const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
    if (!shopIdRaw) {
      return NextResponse.json({ error: 'query param shop_id é obrigatório' }, { status: 400 });
    }
    const shopId = Number(shopIdRaw);
    if (!Number.isFinite(shopId)) {
      return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('shopee_tokens')
      .select('access_token, token_expires_at, shop_name')
      .eq('shop_id', shopId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Loja não conectada' }, { status: 404 });
    }

    if (new Date(data.token_expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'Access token expirado — faça refresh antes de testar' },
        { status: 401 },
      );
    }

    const shopInfo = await shopeeApiCall(
      '/api/v2/shop/get_shop_info',
      {},
      shopId,
      data.access_token,
      'GET',
    );

    return NextResponse.json({
      success: true,
      shop_id: shopId,
      shop_info: shopInfo,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[shopee-test] Erro:', err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
