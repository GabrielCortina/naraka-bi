import { NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/shopee/auth';

// GET /api/auth/shopee
// Inicia o fluxo OAuth da Shopee. Redireciona o browser para a
// página de autorização do Partner portal. Após o seller autorizar,
// Shopee redireciona de volta para SHOPEE_REDIRECT_URL com ?code=&shop_id=.
export async function GET() {
  try {
    const url = getAuthUrl();
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[shopee-connect] Erro:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
