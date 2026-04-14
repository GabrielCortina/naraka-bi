import { createBrowserClient } from '@/lib/supabase-browser';
import type {
  DashboardKpisHero,
  DashboardVendasPorDia,
  DashboardTopSku,
  DashboardRankingLoja,
  DashboardMarketplace,
  DashboardHeatmapHora,
  DashboardKpisSecundarios,
  DashboardComparativoPeriodo,
} from '../types';

function supabase() {
  return createBrowserClient();
}

const RPC_TIMEOUT_MS = 30000;

function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`RPC ${label} timeout após ${ms}ms`)),
      ms,
    );
    Promise.resolve(p).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); },
    );
  });
}

interface RpcParams {
  p_start: string;
  p_end: string;
  p_lojas: string[] | null;
}

// Chama a RPC via API route /api/dashboard/rpc (service_role no servidor).
// Antes era db.rpc() direto do browser, mas o role anon tem
// statement_timeout=3s no Supabase — RPCs de 2-4s estouravam com 500.
// O service_role no servidor não tem esse limite.
async function callRpc<T>(name: string, params: RpcParams): Promise<T[]> {
  try {
    const res = await withTimeout(
      fetch('/api/dashboard/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc: name, params }),
      }),
      RPC_TIMEOUT_MS,
      name,
    );
    if (!res.ok) {
      console.error(`[rpc] ${name} HTTP ${res.status}`);
      return [];
    }
    const json: { data?: unknown; error?: string } = await res.json();
    if (json.error) {
      console.error(`[rpc] ${name} server error:`, json.error);
      return [];
    }
    return (Array.isArray(json.data) ? json.data : []) as T[];
  } catch (err) {
    console.error(`[rpc] ${name} exceção:`, err);
    return [];
  }
}

function buildParams(
  start: string,
  end: string,
  lojas: string[] | null,
): RpcParams {
  return {
    p_start: start,
    p_end: end,
    p_lojas: lojas && lojas.length > 0 ? lojas : null,
  };
}

// ============================================================
// FETCHERS — 1 função por RPC, tipados
// ============================================================

export async function fetchKpisHero(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardKpisHero | null> {
  const rows = await callRpc<DashboardKpisHero>(
    'rpc_kpis_hero', buildParams(start, end, lojas),
  );
  return rows[0] ?? null;
}

export async function fetchKpisHeroAnterior(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardKpisHero | null> {
  const rows = await callRpc<DashboardKpisHero>(
    'rpc_kpis_hero_anterior', buildParams(start, end, lojas),
  );
  return rows[0] ?? null;
}

export async function fetchVendasPorDia(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardVendasPorDia[]> {
  return callRpc<DashboardVendasPorDia>(
    'rpc_vendas_por_dia', buildParams(start, end, lojas),
  );
}

export async function fetchTopSkus(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardTopSku[]> {
  return callRpc<DashboardTopSku>(
    'rpc_top_skus', buildParams(start, end, lojas),
  );
}

export async function fetchRankingLojas(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardRankingLoja[]> {
  return callRpc<DashboardRankingLoja>(
    'rpc_ranking_lojas', buildParams(start, end, lojas),
  );
}

export async function fetchMarketplace(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardMarketplace[]> {
  return callRpc<DashboardMarketplace>(
    'rpc_marketplace', buildParams(start, end, lojas),
  );
}

export async function fetchHeatmap(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardHeatmapHora[]> {
  return callRpc<DashboardHeatmapHora>(
    'rpc_heatmap', buildParams(start, end, lojas),
  );
}

export async function fetchKpisSecundariosRpc(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardKpisSecundarios | null> {
  const rows = await callRpc<DashboardKpisSecundarios>(
    'rpc_kpis_secundarios', buildParams(start, end, lojas),
  );
  return rows[0] ?? null;
}

export async function fetchComparativoPeriodos(
  start: string, end: string, lojas: string[] | null,
): Promise<DashboardComparativoPeriodo[]> {
  return callRpc<DashboardComparativoPeriodo>(
    'rpc_comparativo_periodos', buildParams(start, end, lojas),
  );
}

// ============================================================
// Resolve o valor do filtro de loja (nome_loja ou nome_exibicao
// ou ecommerce_nome_tiny) para um array de ecommerce_nome_tiny
// que as RPCs esperam em p_lojas.
//
// Corrige §3.2 da auditoria: filtro antes era .eq('ecommerce_nome', loja)
// que falhava quando `loja` era um agrupador (nome_loja) e não casava
// com ecommerce_nome cru nos pedidos.
// ============================================================
export async function resolveLojaToEcommerceNomes(
  loja: string | null,
): Promise<string[] | null> {
  if (!loja) return null;

  const db = supabase();
  const { data } = await db
    .from('loja_config')
    .select('ecommerce_nome_tiny, nome_loja, nome_exibicao');

  if (!data || data.length === 0) return [loja];

  const matches = data
    .filter(c =>
      c.nome_loja === loja ||
      c.nome_exibicao === loja ||
      c.ecommerce_nome_tiny === loja,
    )
    .map(c => c.ecommerce_nome_tiny as string);

  return matches.length > 0 ? matches : [loja];
}
