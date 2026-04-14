import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente Supabase com service_role para uso exclusivo em API Routes (servidor).
// Tem acesso total ao banco, bypassa RLS. Roda como usuário 'postgres' —
// SEM o statement_timeout=3s do role anon.
//
// Singleton: evita overhead de criação em cada invocação serverless.
let _serviceClient: SupabaseClient | null = null;

export function createServiceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Variáveis SUPABASE não configuradas no servidor');
  }

  _serviceClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _serviceClient;
}
