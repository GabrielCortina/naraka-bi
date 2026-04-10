import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/tiny-auth';

// GET /api/auth/tiny/callback
// Callback do OAuth — recebe o code e troca por tokens
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const error = request.nextUrl.searchParams.get('error');

  if (error) {
    console.error('[oauth-callback] Erro da Tiny:', error);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}?error=oauth_denied`);
  }

  if (!code) {
    return NextResponse.json({ error: 'Parâmetro code ausente' }, { status: 400 });
  }

  try {
    await exchangeCodeForTokens(code);
    console.log('[oauth-callback] Token obtido e salvo com sucesso');

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}?connected=true`);
  } catch (err) {
    console.error('[oauth-callback] Erro:', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${appUrl}?error=token_exchange_failed`);
  }
}
