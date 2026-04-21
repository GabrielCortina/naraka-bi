import { createServiceClient } from '@/lib/supabase-server';
import { shopeeApiCall, type ShopeeApiResponse } from '@/lib/shopee/client';
import { refreshAccessToken } from '@/lib/shopee/auth';

// Utilitários compartilhados pelos jobs de sync da Shopee.
// Convenções:
//   - [shopee-sync][<job>] nos logs estruturados.
//   - Erro de auth (error_auth / invalid access_token) dispara refresh automático.
//   - Falha de refresh marca a loja como is_active=false em shopee_tokens.

export interface ActiveShop {
  shop_id: number;
  shop_name: string | null;
  access_token: string;
  refresh_token: string;
}

export interface Checkpoint {
  shop_id: number;
  job_name: string;
  last_window_from: string | null;
  last_window_to: string | null;
  last_cursor: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  is_running: boolean;
  run_started_at: string | null;
}

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STUCK_LOCK_MS = 15 * 60 * 1000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getActiveShops(): Promise<ActiveShop[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name, access_token, refresh_token')
    .eq('is_active', true);
  if (error) throw new Error(`Falha ao listar lojas ativas: ${error.message}`);
  return (data ?? []) as ActiveShop[];
}

export async function getShopById(shopId: number): Promise<ActiveShop | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name, access_token, refresh_token')
    .eq('shop_id', shopId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as ActiveShop | null) ?? null;
}

// Round-robin: seleciona a loja mais atrasada para este job (last_success_at
// ASC, nulls first). Permite que cada execução do cron foque em UMA loja —
// com 3 lojas e cron 10min, cada loja é processada ~a cada 30min.
export async function pickNextShop(jobName: string): Promise<ActiveShop | null> {
  const shops = await getActiveShops();
  if (shops.length === 0) return null;
  if (shops.length === 1) return shops[0];

  const supabase = createServiceClient();
  const { data: checkpoints } = await supabase
    .from('shopee_sync_checkpoint')
    .select('shop_id, last_success_at')
    .eq('job_name', jobName)
    .in(
      'shop_id',
      shops.map(s => s.shop_id),
    );

  const lastMap = new Map<number, string | null>();
  for (const c of checkpoints ?? []) {
    lastMap.set(c.shop_id as number, (c.last_success_at as string | null) ?? null);
  }

  shops.sort((a, b) => {
    const la = lastMap.get(a.shop_id) ?? null;
    const lb = lastMap.get(b.shop_id) ?? null;
    if (la === null && lb === null) return a.shop_id - b.shop_id;
    if (la === null) return -1;
    if (lb === null) return 1;
    return la.localeCompare(lb);
  });

  return shops[0];
}

// Resolve a loja-alvo para um job:
// - Se shopIdParam foi informado: usa exatamente essa loja (manual override).
// - Senão: round-robin via pickNextShop.
export async function resolveTargetShop(
  jobName: string,
  shopIdParam: string | null,
): Promise<ActiveShop | null> {
  if (shopIdParam) {
    const id = Number(shopIdParam);
    if (!Number.isFinite(id)) return null;
    return await getShopById(id);
  }
  return await pickNextShop(jobName);
}

// Busca o checkpoint. Cria row se ainda não existe. Auto-libera lock travado > 15min.
export async function getCheckpoint(shopId: number, jobName: string): Promise<Checkpoint> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_sync_checkpoint')
    .select('*')
    .eq('shop_id', shopId)
    .eq('job_name', jobName)
    .maybeSingle();

  if (data) {
    if (data.is_running && data.run_started_at) {
      const started = new Date(data.run_started_at).getTime();
      if (Date.now() - started > STUCK_LOCK_MS) {
        await supabase
          .from('shopee_sync_checkpoint')
          .update({ is_running: false })
          .eq('shop_id', shopId)
          .eq('job_name', jobName);
        data.is_running = false;
      }
    }
    return data as Checkpoint;
  }

  const { data: inserted, error } = await supabase
    .from('shopee_sync_checkpoint')
    .insert({ shop_id: shopId, job_name: jobName })
    .select('*')
    .single();
  if (error) throw new Error(`Falha ao criar checkpoint: ${error.message}`);
  return inserted as Checkpoint;
}

// Tenta adquirir o lock (is_running=false → true). Retorna false se já estava rodando.
export async function lockCheckpoint(shopId: number, jobName: string): Promise<boolean> {
  await getCheckpoint(shopId, jobName);
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_sync_checkpoint')
    .update({ is_running: true, run_started_at: new Date().toISOString() })
    .eq('shop_id', shopId)
    .eq('job_name', jobName)
    .eq('is_running', false)
    .select('id')
    .maybeSingle();
  return data != null;
}

export async function updateCheckpoint(
  shopId: number,
  jobName: string,
  patch: Partial<Omit<Checkpoint, 'shop_id' | 'job_name'>>,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from('shopee_sync_checkpoint')
    .update(patch)
    .eq('shop_id', shopId)
    .eq('job_name', jobName);
}

// Enfileira uma ação para o worker. Deduplica por dedupe_key
// (`${action}:${shopId}:${entityId}`) entre itens PENDING/PROCESSING.
//
// Para cobrir registros antigos criados antes da migration 045
// (que ainda não carregam dedupe_key), fallback pelo match legado
// (shop, entity_type, entity_id, action). Esse segundo check pode ser
// removido após a transição — quando não houver mais PENDING/PROCESSING
// com dedupe_key NULL.
//
// Não usamos ON CONFLICT porque o índice idx_queue_dedupe da 045 é
// parcial não-UNIQUE (decisão Etapa 1).
export async function enqueueAction(
  shopId: number,
  entityType: string,
  entityId: string | null,
  action: string,
  priority = 5,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const supabase = createServiceClient();
  const dedupeKey = `${action}:${shopId}:${entityId ?? ''}`;

  const { data: byKey } = await supabase
    .from('shopee_sync_queue')
    .select('id')
    .eq('dedupe_key', dedupeKey)
    .in('status', ['PENDING', 'PROCESSING'])
    .maybeSingle();
  if (byKey) return false;

  let legacy = supabase
    .from('shopee_sync_queue')
    .select('id')
    .eq('shop_id', shopId)
    .eq('entity_type', entityType)
    .eq('action', action)
    .is('dedupe_key', null)
    .in('status', ['PENDING', 'PROCESSING']);
  legacy = entityId == null ? legacy.is('entity_id', null) : legacy.eq('entity_id', entityId);
  const { data: byLegacy } = await legacy.maybeSingle();
  if (byLegacy) return false;

  const { error } = await supabase.from('shopee_sync_queue').insert({
    shop_id: shopId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    priority,
    metadata: metadata ?? null,
    dedupe_key: dedupeKey,
    status: 'PENDING',
    next_retry_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao enfileirar: ${error.message}`);
  return true;
}

// Backoff em minutos para cada tentativa (1..5). Após 5 o worker marca DEAD.
export function calculateBackoffMinutes(attemptCount: number): number {
  const schedule = [5, 15, 60, 360, 1440];
  const idx = Math.min(Math.max(attemptCount, 1), schedule.length) - 1;
  return schedule[idx];
}

// Wrapper de chamadas autenticadas com refresh automático de token.
// Muta `shop.access_token`/`shop.refresh_token` ao renovar — futuros usos no
// mesmo request já carregam o token novo.
export async function shopeeCallWithRefresh<T>(
  shop: ActiveShop,
  path: string,
  params: Record<string, unknown>,
  method: 'GET' | 'POST' = 'GET',
): Promise<ShopeeApiResponse<T>> {
  try {
    return await shopeeApiCall<T>(path, params, shop.shop_id, shop.access_token, method);
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    const isAuth =
      msg.includes('error_auth') ||
      msg.includes('invalid access_token') ||
      msg.includes('invalid_access_token');
    if (!isAuth) throw err;

    console.log(`[shopee-sync] token expirado para shop_id=${shop.shop_id} — refresh`);

    let newTokens;
    try {
      newTokens = await refreshAccessToken(shop.refresh_token, shop.shop_id);
    } catch (refreshErr) {
      const rmsg = refreshErr instanceof Error ? refreshErr.message : 'unknown';
      console.error(
        `[shopee-sync] refresh FALHOU shop_id=${shop.shop_id} — marcando inativa:`,
        rmsg,
      );
      const supabase = createServiceClient();
      await supabase
        .from('shopee_tokens')
        .update({ is_active: false })
        .eq('shop_id', shop.shop_id);
      throw new Error(
        `Refresh inválido para shop ${shop.shop_id} — loja marcada como inativa. Reautorizar.`,
      );
    }

    const supabase = createServiceClient();
    const now = Date.now();
    await supabase
      .from('shopee_tokens')
      .update({
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        token_expires_at: new Date(now + TOKEN_TTL_MS).toISOString(),
        refresh_expires_at: new Date(now + REFRESH_TTL_MS).toISOString(),
      })
      .eq('shop_id', shop.shop_id);

    shop.access_token = newTokens.access_token;
    shop.refresh_token = newTokens.refresh_token;

    return await shopeeApiCall<T>(path, params, shop.shop_id, shop.access_token, method);
  }
}

// Conversão defensiva: Unix seconds (ou null) → ISO string (ou null).
export function tsToIso(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts * 1000).toISOString();
}

// Shopee BR exige DD-MM-YYYY em /ads/*. YYYY-MM-DD é rejeitado.
export function fmtDMY(tsSec: number): string {
  const d = new Date(tsSec * 1000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}-${m}-${d.getUTCFullYear()}`;
}
