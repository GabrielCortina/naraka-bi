import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Status de tokens muda a cada refresh/expiração — não pode ser cacheado.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/shopee/shops
// Lista lojas Shopee conectadas (metadata pública — sem tokens).
export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('shopee_tokens')
      .select('shop_id, shop_name, token_expires_at, refresh_expires_at, is_active, updated_at, created_at')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[shopee-shops] Erro:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ shops: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
