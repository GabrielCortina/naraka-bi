import { NextResponse } from 'next/server';

// GET /api/auth/tiny/connect
// Redireciona o usuário para o fluxo OAuth da Tiny
export async function GET() {
  const clientId = process.env.TINY_CLIENT_ID;
  const redirectUri = process.env.TINY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: 'Variáveis TINY_CLIENT_ID ou TINY_REDIRECT_URI não configuradas' },
      { status: 500 }
    );
  }

  const authUrl = new URL('https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('response_type', 'code');

  return NextResponse.redirect(authUrl.toString());
}
