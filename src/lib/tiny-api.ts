import { getValidAccessToken } from './tiny-auth';
import type { TinyPedidoListResponse, TinyPedidoFull } from '@/types/tiny';

const BASE_URL = 'https://api.tiny.com.br/public-api/v3';

// Converte para formato ISO sem timezone e sem milissegundos: yyyy-MM-ddTHH:mm:ss
// A API Tiny v3 retorna datas nesse formato, então provavelmente aceita como input
function toTinyDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toISOString().replace(/\.\d{3}Z$/, '');
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
async function waitForRateLimit(rateLimit: RateLimitInfo): Promise<void> {
  if (rateLimit.remaining <= 2) {
    const waitMs = (rateLimit.resetSeconds + 1) * 1000;
    console.log(`[tiny-api] Rate limit quase esgotado (${rateLimit.remaining}). Aguardando ${rateLimit.resetSeconds + 1}s...`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

// Faz requisição autenticada à API Tiny com controle de rate limit
async function tinyFetch<T>(
  path: string,
  params?: Record<string, string>
): Promise<{ data: T; rateLimit: RateLimitInfo }> {
  const token = await getValidAccessToken();

  // Monta a query string manualmente para evitar encode excessivo
  // URLSearchParams codifica "/" e ":" que a Tiny não aceita encodados
  let fullUrl = `${BASE_URL}${path}`;
  if (params) {
    const qs = Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v.replace(/ /g, '+')}`)
      .join('&');
    if (qs) fullUrl += `?${qs}`;
  }

  console.log(`[tiny-api] GET ${fullUrl}`);

  const response = await fetch(fullUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const rateLimit = extractRateLimit(response.headers);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Tiny API erro ${response.status}: ${error}`);
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

  if (params.dataAtualizacao) queryParams.dataAtualizacao = toTinyDateTime(params.dataAtualizacao);
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
