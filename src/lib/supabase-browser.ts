import { createClient } from '@supabase/supabase-js';

// Cliente Supabase com anon key para uso no frontend (browser)
// Respeita RLS — acesso limitado
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Variáveis SUPABASE não configuradas no browser');
  }

  return createClient(url, key);
}
