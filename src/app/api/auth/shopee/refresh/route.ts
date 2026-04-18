import { NextRequest, NextResponse } from 'next/server';
import { refreshAccessToken } from '@/lib/shopee/auth';
import { createServiceClient } from '@/lib/supabase-server';

// Rotas Shopee assinam com timestamp fresh — nunca podem ser cacheadas.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

// POST /api/auth/shopee/refresh
// Body: { shop_id: number }
// Renova o par de tokens da Shopee. O refresh_token anterior é invalidado
// após sucesso — por isso gravamos o novo imediatamente.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const shopIdRaw = body?.shop_id;
    const shopId = Number(shopIdRaw);
    if (!Number.isFinite(shopId)) {
      return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('shopee_tokens')
      .select('refresh_token')
      .eq('shop_id', shopId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Tokens não encontrados para este shop_id' },
        { status: 404 },
      );
    }

    const tokens = await refreshAccessToken(data.refresh_token, shopId);

    const now = Date.now();
    const tokenExpiresAt = new Date(now + tokens.expire_in * 1000).toISOString();
    const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS).toISOString();

    const { error: updateError } = await supabase
      .from('shopee_tokens')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt,
        refresh_expires_at: refreshExpiresAt,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('shop_id', shopId);

    if (updateError) {
      console.error('[shopee-refresh] Falha ao salvar novos tokens:', updateError);
      return NextResponse.json({ error: 'Falha ao persistir tokens' }, { status: 500 });
    }

    return NextResponse.json({ success: true, expires_at: tokenExpiresAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[shopee-refresh] Erro:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
