import type {
  DashboardKpisHero,
  DashboardVendasPorDia,
  DashboardTopSku,
  DashboardRankingLoja,
  DashboardMarketplace,
  DashboardHeatmapHora,
  DashboardKpisSecundarios,
  DashboardComparativoPeriodo,
  DashboardSkuDetalhe,
  SkuDetalhe,
} from '../types';

// Timeout client-side alinhado com Vercel maxDuration (Edge ~25s, mas o
// gargalo real é o Postgres). 9s dá margem antes do hobby tier de 10s.
const RPC_TIMEOUT_MS = 9000;

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

// Chama RPC via API route /api/dashboard/rpc (service_role no servidor).
// O servidor resolve `loja` (label) → array de ecommerce_nome via loja_config
// e injeta em params.p_lojas. Cliente nunca toca em loja_config.
async function callRpc<T>(
  name: string,
  params: Record<string, unknown>,
  loja: string | null,
): Promise<T[]> {
  try {
    const res = await withTimeout(
      fetch('/api/dashboard/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc: name, params, loja }),
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

function buildPeriodoParams(start: string, end: string) {
  return { p_start: start, p_end: end };
}

// ============================================================
// FETCHERS — 1 função por RPC, tipados.
// `loja: string | null` — o servidor resolve em ecommerce_nome[].
// ============================================================

export async function fetchKpisHero(
  start: string, end: string, loja: string | null,
): Promise<DashboardKpisHero | null> {
  const rows = await callRpc<DashboardKpisHero>(
    'rpc_kpis_hero', buildPeriodoParams(start, end), loja,
  );
  return rows[0] ?? null;
}

export async function fetchKpisHeroAnterior(
  start: string, end: string, loja: string | null,
): Promise<DashboardKpisHero | null> {
  const rows = await callRpc<DashboardKpisHero>(
    'rpc_kpis_hero_anterior', buildPeriodoParams(start, end), loja,
  );
  return rows[0] ?? null;
}

export async function fetchVendasPorDia(
  start: string, end: string, loja: string | null,
): Promise<DashboardVendasPorDia[]> {
  return callRpc<DashboardVendasPorDia>(
    'rpc_vendas_por_dia', buildPeriodoParams(start, end), loja,
  );
}

export async function fetchTopSkus(
  start: string, end: string, loja: string | null,
): Promise<DashboardTopSku[]> {
  return callRpc<DashboardTopSku>(
    'rpc_top_skus', buildPeriodoParams(start, end), loja,
  );
}

export async function fetchRankingLojas(
  start: string, end: string, loja: string | null,
): Promise<DashboardRankingLoja[]> {
  return callRpc<DashboardRankingLoja>(
    'rpc_ranking_lojas', buildPeriodoParams(start, end), loja,
  );
}

export async function fetchMarketplace(
  start: string, end: string, loja: string | null,
): Promise<DashboardMarketplace[]> {
  return callRpc<DashboardMarketplace>(
    'rpc_marketplace', buildPeriodoParams(start, end), loja,
  );
}

export async function fetchHeatmap(
  start: string, end: string, loja: string | null,
): Promise<DashboardHeatmapHora[]> {
  return callRpc<DashboardHeatmapHora>(
    'rpc_heatmap', buildPeriodoParams(start, end), loja,
  );
}

export async function fetchKpisSecundariosRpc(
  start: string, end: string, loja: string | null,
): Promise<DashboardKpisSecundarios | null> {
  const rows = await callRpc<DashboardKpisSecundarios>(
    'rpc_kpis_secundarios', buildPeriodoParams(start, end), loja,
  );
  return rows[0] ?? null;
}

export async function fetchComparativoPeriodos(
  start: string, end: string, loja: string | null,
): Promise<DashboardComparativoPeriodo[]> {
  return callRpc<DashboardComparativoPeriodo>(
    'rpc_comparativo_periodos', buildPeriodoParams(start, end), loja,
  );
}

// Substitui getSkuDetalhes (caminho antigo via anon + fetchAllPedidos).
// Calcula percentual no client a partir do faturamento total.
export async function fetchSkuDetalhes(
  skuPai: string,
  start: string,
  end: string,
  loja: string | null,
): Promise<SkuDetalhe[]> {
  const rows = await callRpc<DashboardSkuDetalhe>(
    'rpc_sku_detalhes',
    { p_sku_pai: skuPai, p_start: start, p_end: end },
    loja,
  );
  const total = rows.reduce((s, r) => s + Number(r.faturamento || 0), 0);
  return rows.map(r => {
    const faturamento = Number(r.faturamento || 0);
    return {
      sku: r.sku,
      descricao: r.descricao,
      quantidade: Number(r.quantidade || 0),
      faturamento,
      percentual: total > 0 ? (faturamento / total) * 100 : 0,
    };
  });
}

// ============================================================
// FASE 2 — RPCs CONSOLIDADAS (migration 023) + ENDPOINT BATCH
// ============================================================

interface DashboardKpisHeroV2Row extends DashboardKpisHero {
  periodo: 'atual' | 'anterior';
}

// Hero v2: retorna atual + anterior em 1 chamada (substitui fetchKpisHero
// + fetchKpisHeroAnterior). Usado no Group 1 do progressive loading.
export async function fetchKpisHeroV2(
  start: string, end: string, loja: string | null,
): Promise<{ atual: DashboardKpisHero | null; anterior: DashboardKpisHero | null }> {
  const rows = await callRpc<DashboardKpisHeroV2Row>(
    'rpc_kpis_hero_v2', { p_start: start, p_end: end }, loja,
  );
  return {
    atual:    rows.find(r => r.periodo === 'atual')    ?? null,
    anterior: rows.find(r => r.periodo === 'anterior') ?? null,
  };
}

interface DashboardVendasPorDiaV2Row extends DashboardVendasPorDia {
  periodo: 'atual' | 'anterior';
}

// ============================================================
// callBatch — uma única requisição POST para múltiplas RPCs.
// Server-side faz Promise.all e retorna array na mesma ordem.
// ============================================================
interface BatchCallSpec {
  name: string;
  params: Record<string, unknown>;
  loja: string | null;
}

interface BatchResultEntry {
  data: unknown[];
  error?: string;
}

async function callBatch(calls: BatchCallSpec[]): Promise<unknown[][]> {
  if (calls.length === 0) return [];
  try {
    const res = await withTimeout(
      fetch('/api/dashboard/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calls: calls.map(c => ({ rpc: c.name, params: c.params, loja: c.loja })),
        }),
      }),
      RPC_TIMEOUT_MS,
      'batch',
    );
    if (!res.ok) {
      console.error(`[batch] HTTP ${res.status}`);
      return calls.map(() => []);
    }
    const json: { results?: BatchResultEntry[]; error?: string } = await res.json();
    if (json.error) {
      console.error('[batch] server error:', json.error);
      return calls.map(() => []);
    }
    const results = json.results ?? [];
    return calls.map((_, i) => {
      const r = results[i];
      if (!r) return [];
      if (r.error) console.error(`[batch] ${calls[i].name} server error:`, r.error);
      return Array.isArray(r.data) ? r.data : [];
    });
  } catch (err) {
    console.error('[batch] exceção:', err);
    return calls.map(() => []);
  }
}

export interface DashboardSecundarioBundle {
  topSkus: DashboardTopSku[];
  rankingLojas: DashboardRankingLoja[];
  marketplace: DashboardMarketplace[];
  heatmap: DashboardHeatmapHora[];
  kpisSecundarios: DashboardKpisSecundarios | null;
  comparativo: DashboardComparativoPeriodo[];
  vendasPorDia: DashboardVendasPorDia[];
  vendasPorDiaAnterior: DashboardVendasPorDia[];
}

// Group 2 do progressive loading: 7 RPCs em 1 invocação Vercel.
// Antes da Fase 2: 8 chamadas separadas (top, ranking, mp, heatmap,
// secundarios, comparativo, vendasDia, vendasDiaAnt).
// Agora: 1 batch com 7 RPCs (vendasDia atual+anterior é v2 unificada).
export async function fetchDashboardSecundario(
  start: string, end: string,
  startAnt: string, endAnt: string,
  loja: string | null,
): Promise<DashboardSecundarioBundle> {
  const periodoParams = { p_start: start, p_end: end };

  const calls: BatchCallSpec[] = [
    { name: 'rpc_top_skus',                 params: periodoParams, loja },
    { name: 'rpc_ranking_lojas',            params: periodoParams, loja },
    { name: 'rpc_marketplace',              params: periodoParams, loja },
    { name: 'rpc_heatmap',                  params: periodoParams, loja },
    { name: 'rpc_kpis_secundarios',         params: periodoParams, loja },
    { name: 'rpc_comparativo_periodos_v2',  params: periodoParams, loja },
    {
      name: 'rpc_vendas_por_dia_v2',
      params: { p_start: start, p_end: end, p_start_ant: startAnt, p_end_ant: endAnt },
      loja,
    },
  ];

  const r = await callBatch(calls);

  const topSkus          = r[0] as DashboardTopSku[];
  const rankingLojas     = r[1] as DashboardRankingLoja[];
  const marketplace      = r[2] as DashboardMarketplace[];
  const heatmap          = r[3] as DashboardHeatmapHora[];
  const secundariosArr   = r[4] as DashboardKpisSecundarios[];
  const comparativo      = r[5] as DashboardComparativoPeriodo[];
  const vendasV2         = r[6] as DashboardVendasPorDiaV2Row[];

  return {
    topSkus,
    rankingLojas,
    marketplace,
    heatmap,
    kpisSecundarios: secundariosArr.length > 0 ? secundariosArr[0] : null,
    comparativo,
    vendasPorDia:          vendasV2.filter(v => v.periodo === 'atual'),
    vendasPorDiaAnterior:  vendasV2.filter(v => v.periodo === 'anterior'),
  };
}
