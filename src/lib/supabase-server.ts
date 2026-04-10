import { createClient } from '@supabase/supabase-js';

// Cliente Supabase com service_role para uso exclusivo em API Routes (servidor)
// Tem acesso total ao banco, bypassa RLS
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Variáveis SUPABASE não configuradas no servidor');
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
