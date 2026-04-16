import { createServiceClient } from '@/lib/supabase-server';

// Allowlist compartilhada entre /api/dashboard/rpc e /api/dashboard/batch.
// Inclui as RPCs originais (020/021/022), v2 (023) e v3 (024).
export const ALLOWED_RPCS: ReadonlySet<string> = new Set([
  'rpc_kpis_hero',
  'rpc_kpis_hero_anterior',
  'rpc_kpis_hero_v2',
  'rpc_kpis_hero_v3',
  'rpc_vendas_por_dia',
  'rpc_vendas_por_dia_v2',
  'rpc_vendas_por_dia_v3',
  'rpc_top_skus',
  'rpc_ranking_lojas',
  'rpc_ranking_lojas_v3',
  'rpc_marketplace',
  'rpc_marketplace_v3',
  'rpc_heatmap',
  'rpc_kpis_secundarios',
  'rpc_kpis_secundarios_v3',
  'rpc_comparativo_periodos',
  'rpc_comparativo_periodos_v2',
  'rpc_comparativo_periodos_v3',
  'rpc_sku_detalhes',
  'rpc_sku_alias_list',
  'rpc_sku_kit_list',
  'rpc_alertas_calcular',
  'rpc_alertas_calcular_hoje',
  'rpc_alertas_resumo',
  'rpc_alertas_pinados_status',
]);

interface LojaConfigRow {
  ecommerce_nome_tiny: string;
  nome_loja: string | null;
  nome_exibicao: string | null;
}

// Cache leve no escopo do isolate (Edge Runtime). 5min é suficiente
// para evitar refetch em cada request enquanto o usuário troca filtros.
let _lojaCfgCache: { data: LojaConfigRow[]; ts: number } | null = null;
const LOJA_CFG_TTL_MS = 5 * 60 * 1000;

export async function resolveLojaServerSide(loja: string): Promise<string[]> {
  const now = Date.now();
  if (!_lojaCfgCache || now - _lojaCfgCache.ts > LOJA_CFG_TTL_MS) {
    const db = createServiceClient();
    const { data } = await db
      .from('loja_config')
      .select('ecommerce_nome_tiny, nome_loja, nome_exibicao');
    _lojaCfgCache = { data: (data as LojaConfigRow[]) ?? [], ts: now };
  }
  const matches = _lojaCfgCache.data
    .filter(
      c =>
        c.nome_loja === loja ||
        c.nome_exibicao === loja ||
        c.ecommerce_nome_tiny === loja,
    )
    .map(c => c.ecommerce_nome_tiny);
  return matches.length > 0 ? matches : [loja];
}
