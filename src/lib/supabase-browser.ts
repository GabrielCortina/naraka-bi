import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cliente Supabase com anon key para uso no frontend (browser)
// Respeita RLS — acesso limitado
//
// Singleton — evita o warning "Multiple GoTrueClient instances detected
// in the same browser context" quando várias partes do app chamam este helper.
let _client: SupabaseClient | null = null;

export function createBrowserClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Variáveis SUPABASE não configuradas no browser');
  }

  _client = createClient(url, key);
  return _client;
}
