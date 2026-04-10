import { createServiceClient } from './supabase-server';
import type { TinyTokens } from '@/types/tiny';
import type { TinyTokenRow } from '@/types/database';

const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';

// Busca o token mais recente do banco
async function getStoredToken(): Promise<TinyTokenRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('tiny_tokens')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  return data;
}

// Salva ou atualiza o token no banco
async function saveToken(tokens: TinyTokens): Promise<void> {
  const supabase = createServiceClient();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Upsert no registro id=1 (singleton — só temos uma conta Tiny)
  await supabase.from('tiny_tokens').upsert({
    id: 1,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
}

// Troca o authorization_code por tokens
export async function exchangeCodeForTokens(code: string): Promise<TinyTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.TINY_CLIENT_ID!,
      client_secret: process.env.TINY_CLIENT_SECRET!,
      redirect_uri: process.env.TINY_REDIRECT_URI!,
      code,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro ao trocar código por token: ${response.status} - ${error}`);
  }

  const tokens: TinyTokens = await response.json();
  await saveToken(tokens);
  return tokens;
}

// Renova o token usando refresh_token
async function refreshAccessToken(refreshToken: string): Promise<TinyTokens> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.TINY_CLIENT_ID!,
      client_secret: process.env.TINY_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Erro ao renovar token: ${response.status} - ${error}`);
  }

  const tokens: TinyTokens = await response.json();
  await saveToken(tokens);
  return tokens;
}

// Retorna um access_token válido, renovando se necessário
// Renova com 5 minutos de margem antes da expiração
export async function getValidAccessToken(): Promise<string> {
  const stored = await getStoredToken();

  if (!stored) {
    throw new Error('Nenhum token Tiny encontrado. Faça a autenticação OAuth primeiro.');
  }

  const expiresAt = new Date(stored.expires_at).getTime();
  const now = Date.now();
  const marginMs = 5 * 60 * 1000; // 5 minutos de margem

  if (now < expiresAt - marginMs) {
    return stored.access_token;
  }

  // Token expirado ou quase expirando — renovar
  console.log('[tiny-auth] Token expirado, renovando...');
  const newTokens = await refreshAccessToken(stored.refresh_token);
  return newTokens.access_token;
}

// Verifica se temos uma conexão ativa com a Tiny
export async function isTinyConnected(): Promise<{
  connected: boolean;
  expiresAt: string | null;
}> {
  try {
    const stored = await getStoredToken();
    if (!stored) return { connected: false, expiresAt: null };

    const refreshExpiry = new Date(stored.updated_at).getTime() + 24 * 60 * 60 * 1000;

    // Se o refresh token já expirou (mais de 1 dia), não está conectado
    if (Date.now() > refreshExpiry) {
      return { connected: false, expiresAt: null };
    }

    return { connected: true, expiresAt: stored.expires_at };
  } catch {
    return { connected: false, expiresAt: null };
  }
}
