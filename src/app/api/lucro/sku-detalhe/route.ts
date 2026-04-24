import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Endpoint de detalhe do modal de SKU (aba Lucro e Prejuízo).
// Retorna agregações por loja, por tamanho e a lista de piores pedidos.
//
// Fonte: lucro_pedido_stats com sku_pais @> [sku_pai] no intervalo.
// Usa lucro_operacional e margem_operacional_pct (sem rateios ads/FBS).
// Descrição: dashboard_sku_daily_stats (mais recente no intervalo).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE_DB = 1000;
const BR_OFFSET_MS = 3 * 3600 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Period = 'today' | 'yesterday' | '7d' | '15d' | 'month' | 'custom';

interface LucroRow {
  order_sn: string;
  shop_id: number;
  data_liberacao: string;
  venda: number;
  receita_liquida: number;
  comissao: number;
  taxa_servico: number;
  afiliado: number;
  cupom_seller: number;
  frete_reverso: number;
  frete_ida_seller: number;
  difal: number;
  cmv: number;
  tem_cmv: boolean;
  skus: string[];
  sku_pais: string[];
  qtd_itens: number;
  lucro_operacional: number;
  margem_operacional_pct: number;
  tem_devolucao: boolean;
  tem_afiliado: boolean;
  status: string;
}

function brDateString(d: Date): string {
  const shifted = new Date(d.getTime() - BR_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function parsePeriod(period: Period, from: string | null, to: string | null): { from: string; to: string } {
  const today = brDateString(new Date());
  switch (period) {
    case 'today':     return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case '7d':        return { from: addDays(today, -6), to: today };
    case '15d':       return { from: addDays(today, -14), to: today };
    case 'month': {
      const [y, m] = today.split('-').map(Number);
      return { from: `${y}-${String(m).padStart(2, '0')}-01`, to: today };
    }
    case 'custom':
      if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
        throw new Error('period=custom requer from/to em YYYY-MM-DD');
      }
      if (from > to) throw new Error('from deve ser ≤ to');
      return { from, to };
  }
}

// Parte após o último hífen. SKU "90909P-G" → "G". "90909" → null.
function extrairTamanho(sku: string): string | null {
  const idx = sku.lastIndexOf('-');
  if (idx < 0 || idx === sku.length - 1) return null;
  return sku.slice(idx + 1);
}

// Defesa contra Supabase devolver TEXT[] como string literal de array Postgres
// ('{"70006-44","70006-46"}'). Normaliza para string[].
function normSkus(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    return raw
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}

// Nome curto da loja: remove sufixos comuns ("Jeans - SHOPEE", " - SHOPEE").
function nomeLojaCurto(full: string | null): string {
  if (!full) return 'Loja';
  return full.replace(/\s*-\s*SHOPEE.*$/i, '').replace(/\s+Jeans$/i, '').trim() || full;
}

function inferCausa(row: LucroRow): string {
  if (row.tem_devolucao) return 'Devolução';
  if (!row.tem_cmv) return 'Sem CMV';
  if (row.venda > 0 && row.afiliado > row.venda * 0.10) return 'Afiliado alto';
  if (row.venda > 0 && (row.comissao + row.taxa_servico) > row.venda * 0.40) return 'Comissão alta';
  return 'Margem baixa';
}

async function fetchLucroRowsBySkuPai(
  supabase: ReturnType<typeof createServiceClient>,
  skuPai: string,
  from: string,
  to: string,
  shopFilter: number | null,
): Promise<LucroRow[]> {
  const rows: LucroRow[] = [];
  let offset = 0;
  while (true) {
    let q = supabase
      .from('lucro_pedido_stats')
      .select('order_sn, shop_id, data_liberacao, venda, receita_liquida, comissao, taxa_servico, afiliado, cupom_seller, frete_reverso, frete_ida_seller, difal, cmv, tem_cmv, skus, sku_pais, qtd_itens, lucro_operacional, margem_operacional_pct, tem_devolucao, tem_afiliado, status')
      .gte('data_liberacao', from)
      .lte('data_liberacao', to)
      .contains('sku_pais', [skuPai])
      .range(offset, offset + PAGE_SIZE_DB - 1);
    if (shopFilter != null) q = q.eq('shop_id', shopFilter);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as LucroRow[]));
    if (data.length < PAGE_SIZE_DB) break;
    offset += PAGE_SIZE_DB;
  }
  return rows;
}

async function fetchShopNames(
  supabase: ReturnType<typeof createServiceClient>,
  shopIds: number[],
): Promise<Map<number, string | null>> {
  const map = new Map<number, string | null>();
  if (shopIds.length === 0) return map;
  const { data, error } = await supabase
    .from('shopee_tokens')
    .select('shop_id, shop_name')
    .in('shop_id', shopIds);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    map.set(Number(r.shop_id), (r.shop_name as string | null) ?? null);
  }
  return map;
}

interface SkuCustoRow {
  faixa: 'regular' | 'plus' | 'unico';
  tamanhos: string[];
  custo_unitario: number;
  vigencia_inicio: string;
}

async function fetchSkuCusto(
  supabase: ReturnType<typeof createServiceClient>,
  skuPai: string,
): Promise<SkuCustoRow[]> {
  const { data, error } = await supabase
    .from('sku_custo')
    .select('faixa, tamanhos, custo_unitario, vigencia_inicio')
    .eq('sku_pai', skuPai)
    .is('vigencia_fim', null)
    .gt('custo_unitario', 0);
  if (error) return [];
  return (data ?? []) as unknown as SkuCustoRow[];
}

// CMV médio ponderado pelas vendas:
//   - faixa 'unico': retorna o custo direto (mais recente).
//   - regular + plus: classifica cada SKU vendido por tamanho nas faixas e
//     faz média ponderada pelas quantidades observadas.
//   - sem cadastro ou sem match: retorna null (renderizado como "Sem CMV").
function computeCmvMedio(
  rows: LucroRow[],
  skuPai: string,
  custos: SkuCustoRow[],
): number | null {
  if (custos.length === 0) return null;

  // Faixa 'unico' tem prioridade — se existe, usa direto.
  const unico = custos
    .filter(c => c.faixa === 'unico')
    .sort((a, b) => (a.vigencia_inicio < b.vigencia_inicio ? 1 : -1))[0];
  if (unico) return round2(unico.custo_unitario);

  const regular = custos
    .filter(c => c.faixa === 'regular')
    .sort((a, b) => (a.vigencia_inicio < b.vigencia_inicio ? 1 : -1))[0];
  const plus = custos
    .filter(c => c.faixa === 'plus')
    .sort((a, b) => (a.vigencia_inicio < b.vigencia_inicio ? 1 : -1))[0];

  if (!regular && !plus) return null;

  const setRegular = new Set(regular?.tamanhos ?? []);
  const setPlus = new Set(plus?.tamanhos ?? []);

  let qtdRegular = 0;
  let qtdPlus = 0;
  for (const r of rows) {
    for (const s of normSkus(r.skus)) {
      if (!s.startsWith(skuPai)) continue;
      const t = extrairTamanho(s);
      if (!t) continue;
      if (setRegular.has(t)) qtdRegular += 1;
      else if (setPlus.has(t)) qtdPlus += 1;
    }
  }

  const qtdTotal = qtdRegular + qtdPlus;
  if (qtdTotal === 0) return null;

  const custoRegular = regular?.custo_unitario ?? 0;
  const custoPlus = plus?.custo_unitario ?? 0;
  const soma = qtdRegular * custoRegular + qtdPlus * custoPlus;
  return round2(soma / qtdTotal);
}

async function fetchDescricao(
  supabase: ReturnType<typeof createServiceClient>,
  skuPai: string,
  from: string,
  to: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('dashboard_sku_daily_stats')
    .select('descricao, data_pedido')
    .eq('sku_pai', skuPai)
    .gte('data_pedido', from)
    .lte('data_pedido', to)
    .not('descricao', 'is', null)
    .order('data_pedido', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data?.descricao as string | null) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const skuPai = (searchParams.get('sku_pai') ?? '').trim();
  if (!skuPai) {
    return NextResponse.json({ error: 'sku_pai obrigatório' }, { status: 400 });
  }

  const period = (searchParams.get('period') ?? '15d') as Period;
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const shopParam = searchParams.get('shop_id') ?? 'all';

  let range: { from: string; to: string };
  try {
    range = parsePeriod(period, fromParam, toParam);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'período inválido' }, { status: 400 });
  }

  const shopFilter = shopParam === 'all' ? null : Number(shopParam);
  if (shopFilter !== null && !Number.isFinite(shopFilter)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  const supabase = createServiceClient();

  try {
    const rows = await fetchLucroRowsBySkuPai(supabase, skuPai, range.from, range.to, shopFilter);

    const shopIds = Array.from(new Set(rows.map(r => r.shop_id)));
    const [shopMap, descricao, skuCustos] = await Promise.all([
      fetchShopNames(supabase, shopIds),
      fetchDescricao(supabase, skuPai, range.from, range.to),
      fetchSkuCusto(supabase, skuPai),
    ]);

    const cmvMedio = computeCmvMedio(rows, skuPai, skuCustos);

    // ============ POR LOJA ============
    interface LojaAgg {
      shop_id: number;
      shop_name: string;
      qtd: number;
      receita: number;
      cmv: number;
      lucro: number;
      margem_soma: number;
      margem_count: number;
    }
    const porLojaMap = new Map<number, LojaAgg>();
    for (const r of rows) {
      let agg = porLojaMap.get(r.shop_id);
      if (!agg) {
        agg = {
          shop_id: r.shop_id,
          shop_name: shopMap.get(r.shop_id) ?? `Shop ${r.shop_id}`,
          qtd: 0,
          receita: 0,
          cmv: 0,
          lucro: 0,
          margem_soma: 0,
          margem_count: 0,
        };
        porLojaMap.set(r.shop_id, agg);
      }
      agg.qtd += 1;
      agg.receita += r.receita_liquida;
      agg.cmv += r.cmv;
      agg.lucro += r.lucro_operacional;
      if (r.venda > 0) {
        agg.margem_soma += r.margem_operacional_pct;
        agg.margem_count += 1;
      }
    }
    const porLoja = Array.from(porLojaMap.values())
      .map(a => ({
        shop_id: a.shop_id,
        shop_name: a.shop_name,
        shop_name_curto: nomeLojaCurto(a.shop_name),
        qtd: a.qtd,
        receita: round2(a.receita),
        cmv: round2(a.cmv),
        lucro: round2(a.lucro),
        margem: a.margem_count > 0 ? round1(a.margem_soma / a.margem_count) : 0,
      }))
      .sort((a, b) => b.lucro - a.lucro);

    // ============ POR TAMANHO ============
    // Cada pedido contribui uma vez por tamanho distinto presente em skus[]
    // (filtrando apenas SKUs cujo sku_pai bate com o solicitado).
    interface TamAgg {
      tamanho: string;
      qtd: number;
      margem_soma: number;
      margem_count: number;
      lucro: number;
    }
    const porTamanhoMap = new Map<string, TamAgg>();
    for (const r of rows) {
      const tamanhosDoPedido = new Set<string>();
      for (const s of normSkus(r.skus)) {
        if (!s.startsWith(skuPai)) continue;
        const t = extrairTamanho(s);
        if (t) tamanhosDoPedido.add(t);
      }
      for (const t of Array.from(tamanhosDoPedido)) {
        let agg = porTamanhoMap.get(t);
        if (!agg) {
          agg = { tamanho: t, qtd: 0, margem_soma: 0, margem_count: 0, lucro: 0 };
          porTamanhoMap.set(t, agg);
        }
        agg.qtd += 1;
        agg.lucro += r.lucro_operacional;
        if (r.venda > 0) {
          agg.margem_soma += r.margem_operacional_pct;
          agg.margem_count += 1;
        }
      }
    }
    const porTamanho = Array.from(porTamanhoMap.values())
      .map(a => ({
        tamanho: a.tamanho,
        qtd: a.qtd,
        margem: a.margem_count > 0 ? round1(a.margem_soma / a.margem_count) : 0,
        lucro: round2(a.lucro),
      }))
      .sort((a, b) => a.tamanho.localeCompare(b.tamanho, 'pt-BR', { numeric: true }));

    // ============ PIORES PEDIDOS ============
    const piores = [...rows]
      .sort((a, b) => a.lucro_operacional - b.lucro_operacional)
      .slice(0, 5)
      .map(r => {
        // Tamanho representativo: o primeiro SKU do pedido que bate no sku_pai.
        let tamanho: string | null = null;
        for (const s of normSkus(r.skus)) {
          if (!s.startsWith(skuPai)) continue;
          const t = extrairTamanho(s);
          if (t) { tamanho = t; break; }
        }
        return {
          order_sn: r.order_sn,
          data: r.data_liberacao,
          shop_id: r.shop_id,
          loja: nomeLojaCurto(shopMap.get(r.shop_id) ?? null),
          tamanho,
          venda: round2(r.venda),
          lucro: round2(r.lucro_operacional),
          margem: round1(r.margem_operacional_pct),
          causa: inferCausa(r),
          tem_devolucao: r.tem_devolucao,
          tem_afiliado: r.tem_afiliado,
          tem_cmv: r.tem_cmv,
        };
      });

    return NextResponse.json({
      sku_pai: skuPai,
      descricao,
      range,
      cmv_medio: cmvMedio,
      por_loja: porLoja,
      por_tamanho: porTamanho,
      piores_pedidos: piores,
    });
  } catch (err) {
    console.error('[api/lucro/sku-detalhe] erro:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'erro interno' },
      { status: 500 },
    );
  }
}
