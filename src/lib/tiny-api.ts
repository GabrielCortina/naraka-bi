import { getValidAccessToken } from './tiny-auth';
import type { TinyPedidoListResponse, TinyPedidoFull } from '@/types/tiny';

const BASE_URL = 'https://api.tiny.com.br/public-api/v3';

// Converte para formato aceito pela Tiny v3: yyyy-MM-dd (só data, sem hora)
function toTinyDate(dateStr: string): string {
  return new Date(dateStr).toISOString().split('T')[0];
}

interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

// Extrai informações de rate limit dos headers da resposta
function extractRateLimit(headers: Headers): RateLimitInfo {
  return {
    limit: parseInt(headers.get('X-RateLimit-Limit') || '0', 10),
    remaining: parseInt(headers.get('X-RateLimit-Remaining') || '999', 10),
    resetSeconds: parseInt(headers.get('X-RateLimit-Reset') || '60', 10),
  };
}

// Aguarda se necessário para respeitar o rate limit
// Cap máximo de 30s para evitar que a função serverless fique bloqueada
const RATE_LIMIT_MAX_WAIT_MS = 30_000;

async function waitForRateLimit(rateLimit: RateLimitInfo): Promise<void> {
  if (rateLimit.remaining <= 2) {
    const waitCalculado = (rateLimit.resetSeconds + 1) * 1000;
    const waitMs = Math.min(waitCalculado, RATE_LIMIT_MAX_WAIT_MS);
    if (waitCalculado > RATE_LIMIT_MAX_WAIT_MS) {
      console.warn(`[rate-limit] Cap de 30s atingido (calculado: ${rateLimit.resetSeconds + 1}s)`);
    }
    console.log(`[tiny-api] Rate limit quase esgotado (${rateLimit.remaining}). Aguardando ${Math.round(waitMs / 1000)}s...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

// Rate limiter centralizado via Supabase (compartilhado entre instâncias)
const RATE_LIMIT_CENTRAL = 25; // margem abaixo dos 30/min da Tiny
const RATE_LIMIT_JANELA_MS = 60_000; // 1 minuto

async function checkRateLimit(): Promise<void> {
  try {
    const { createServiceClient } = await import('./supabase-server');
    const supabase = createServiceClient();

    // Incremento atômico via RPC (evita race condition)
    const { data: count } = await supabase.rpc('increment_rate_limit', {
      p_id: 'tiny_api',
      p_limite: RATE_LIMIT_CENTRAL,
      p_janela_ms: RATE_LIMIT_JANELA_MS,
    });

    if (count && count > RATE_LIMIT_CENTRAL) {
      // Budget esgotado — busca tempo restante da janela
      const { data: limiter } = await supabase
        .from('rate_limiter')
        .select('janela_inicio')
        .eq('id', 'tiny_api')
        .single();

      if (limiter?.janela_inicio) {
        const espera = RATE_LIMIT_JANELA_MS - (Date.now() - new Date(limiter.janela_inicio).getTime());
        if (espera > 0) {
          const esperaReal = Math.min(espera + 100, RATE_LIMIT_MAX_WAIT_MS);
          console.warn(`[rate-limit-central] Budget esgotado (${count}/${RATE_LIMIT_CENTRAL}). Aguardando ${Math.ceil(esperaReal / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, esperaReal));
        }
      }
    }
  } catch (err) {
    // Se falhar o rate limiter centralizado, continua sem bloquear
    console.warn('[rate-limit-central] Erro ao verificar rate limit:', err instanceof Error ? err.message : err);
  }
}

// Faz requisição autenticada à API Tiny com controle de rate limit duplo
// 1. checkRateLimit() — limiter centralizado via Supabase (entre instâncias)
// 2. waitForRateLimit() — limiter local via headers (dentro da instância)
async function tinyFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<{ data: T; rateLimit: RateLimitInfo }> {
  // Rate limit centralizado (antes de cada chamada)
  await checkRateLimit();

  const token = await getValidAccessToken();

  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const rateLimit = extractRateLimit(response.headers);

  if (!response.ok) {
    const errorBody = await response.text();
    // Detecção de 429 com informação extra
    if (response.status === 429) {
      throw new Error(`Tiny API 429 Too Many Requests: ${errorBody}`);
    }
    throw new Error(`Tiny API erro ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as T;
  return { data, rateLimit };
}

// Lista pedidos com filtros
export async function listarPedidos(params: {
  dataAtualizacao?: string;
  situacao?: number;
  orderBy?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<{ data: TinyPedidoListResponse; rateLimit: RateLimitInfo }> {
  const queryParams: Record<string, string> = {};

  if (params.dataAtualizacao) queryParams.dataAtualizacao = toTinyDate(params.dataAtualizacao);
  if (params.situacao !== undefined) queryParams.situacao = String(params.situacao);
  if (params.orderBy) queryParams.orderBy = params.orderBy;
  if (params.limit) queryParams.limit = String(params.limit);
  if (params.offset !== undefined) queryParams.offset = String(params.offset);

  return tinyFetch<TinyPedidoListResponse>('/pedidos', queryParams);
}

// Busca detalhes completos de um pedido
export async function obterPedido(
  idPedido: number
): Promise<{ data: TinyPedidoFull; rateLimit: RateLimitInfo }> {
  return tinyFetch<TinyPedidoFull>(`/pedidos/${idPedido}`);
}

export { waitForRateLimit, type RateLimitInfo };
