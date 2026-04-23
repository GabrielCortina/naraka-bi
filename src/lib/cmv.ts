import type { SupabaseClient } from '@supabase/supabase-js';

// CMV (custo de mercadoria) por SKU + data do pedido. Base para o
// cálculo de lucro/prejuízo. SKUs sem custo cadastrado retornam 0.
//
// Regras de resolução:
//   - sku_pai: primeira sequência numérica do SKU (ex: "90909P-G" → "90909")
//   - tamanho: parte após o último hífen (ex: "90909P-G" → "G")
//   - vigência: cadastro ativo tem vigencia_inicio <= data_pedido
//     AND (vigencia_fim IS NULL OR vigencia_fim >= data_pedido)
//   - múltiplas faixas para o mesmo sku_pai: usa a que contém o tamanho
//     no array `tamanhos`. 'unico' ignora tamanho — aplica sempre.
//   - se houver 'unico' + outra faixa que bate, faixa específica vence.

export interface CustoRow {
  sku_pai: string;
  faixa: string;
  tamanhos: string[];
  custo_unitario: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
}

export function extractSkuPai(sku: string | null | undefined): string | null {
  if (!sku) return null;
  // Shopee raw SKUs podem vir prefixados com "KIT" ou "KITPC"; ignoramos o
  // prefixo antes de pegar os dígitos para casar com sku_custo.sku_pai.
  // Mantém paridade com resolve_cmv_for_sku em SQL.
  const stripped = sku.replace(/^(KITPC|KIT)/i, '');
  const m = stripped.match(/^(\d+)/);
  return m ? m[1] : null;
}

export function extractTamanho(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const idx = sku.lastIndexOf('-');
  if (idx < 0 || idx === sku.length - 1) return null;
  return sku.slice(idx + 1);
}

function toDateOnly(d: Date | string): string {
  if (typeof d === 'string') return d.length >= 10 ? d.slice(0, 10) : d;
  return d.toISOString().slice(0, 10);
}

// Escolhe o cadastro certo entre os candidatos (mesma sku_pai, vigência
// cobrindo a data). Faixa com match exato de tamanho vence 'unico'.
function pickCusto(candidates: CustoRow[], tamanho: string | null): CustoRow | null {
  if (candidates.length === 0) return null;

  if (tamanho) {
    const exact = candidates.find(
      c => c.faixa !== 'unico' && c.tamanhos.includes(tamanho),
    );
    if (exact) return exact;
  }

  const unico = candidates.find(c => c.faixa === 'unico');
  if (unico) return unico;

  // Fallback: se houver só uma faixa específica e tamanho não bateu,
  // usar mesmo assim — melhor do que devolver 0 silenciosamente.
  return candidates[0];
}

export async function getCMVForItem(
  supabase: SupabaseClient,
  sku: string,
  dataPedido: Date | string,
): Promise<number> {
  const sku_pai = extractSkuPai(sku);
  if (!sku_pai) return 0;

  const tamanho = extractTamanho(sku);
  const dateStr = toDateOnly(dataPedido);

  const { data, error } = await supabase
    .from('sku_custo')
    .select('sku_pai, faixa, tamanhos, custo_unitario, vigencia_inicio, vigencia_fim')
    .eq('sku_pai', sku_pai)
    .lte('vigencia_inicio', dateStr)
    .or(`vigencia_fim.is.null,vigencia_fim.gte.${dateStr}`);

  if (error || !data || data.length === 0) return 0;

  const chosen = pickCusto(data as CustoRow[], tamanho);
  return chosen ? Number(chosen.custo_unitario) : 0;
}

// Expande kits em componentes consultando sku_kit. Aceita items {sku, quantidade, ...}
// e devolve a mesma lista, substituindo itens cujo `sku` é um kit por N linhas dos
// componentes (quantidade = item.quantidade × componente.quantidade). Itens que não
// são kits passam inalterados. Paridade com o pipeline das RPCs 025/026.
export async function expandKits<T extends { sku: string; quantidade: number }>(
  supabase: SupabaseClient,
  items: T[],
  // Callback opcional pra construir descricao/metadata do componente a partir
  // do item original — útil quando o caller quer manter campos extras.
  mergeComponent?: (original: T, comp: { sku: string; quantidade: number }) => T,
): Promise<T[]> {
  if (items.length === 0) return [];

  const distinct = Array.from(new Set(items.map(it => it.sku)));
  const { data, error } = await supabase
    .from('sku_kit')
    .select('sku_kit, sku_componente, quantidade')
    .in('sku_kit', distinct)
    .eq('ativo', true);

  if (error || !data || data.length === 0) return items;

  const map = new Map<string, Array<{ sku: string; quantidade: number }>>();
  for (const row of data) {
    const arr = map.get(row.sku_kit as string) ?? [];
    arr.push({
      sku: row.sku_componente as string,
      quantidade: Number(row.quantidade) || 1,
    });
    map.set(row.sku_kit as string, arr);
  }

  const out: T[] = [];
  for (const it of items) {
    const comps = map.get(it.sku);
    if (!comps || comps.length === 0) {
      out.push(it);
      continue;
    }
    for (const c of comps) {
      const expanded: T = mergeComponent
        ? mergeComponent(it, { sku: c.sku, quantidade: it.quantidade * c.quantidade })
        : { ...it, sku: c.sku, quantidade: it.quantidade * c.quantidade };
      out.push(expanded);
    }
  }
  return out;
}

// Busca aliases para um conjunto de sku_pais. Devolve Map sku_original → sku_pai
// canônico (já com o prefixo numérico extraído quando o sku_canonico tem sufixo,
// replicando o pattern das RPCs 025/026).
export async function resolveAliasBatch(
  supabase: SupabaseClient,
  skuPais: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skuPais.length === 0) return map;

  const distinct = Array.from(new Set(skuPais));
  const { data, error } = await supabase
    .from('sku_alias')
    .select('sku_original, sku_canonico, canal')
    .in('sku_original', distinct)
    .eq('ativo', true);

  if (error || !data) return map;

  // Quando há múltiplos aliases para o mesmo sku_original (diferentes canais),
  // preferimos o registro com canal NULL (alias global) — mesmo tie-break das RPCs.
  const chosen = new Map<string, { canonico: string; canal: string | null }>();
  for (const row of data) {
    const orig = row.sku_original as string;
    const canonico = row.sku_canonico as string;
    const canal = (row.canal as string | null) ?? null;
    const prev = chosen.get(orig);
    if (!prev) { chosen.set(orig, { canonico, canal }); continue; }
    if (prev.canal !== null && canal === null) chosen.set(orig, { canonico, canal });
  }

  for (const [orig, { canonico }] of Array.from(chosen.entries())) {
    const numeric = canonico.match(/^(\d+)/)?.[1];
    map.set(orig, numeric ?? canonico);
  }
  return map;
}

// Versão em lote para cálculos de dashboards/relatórios. Recebe pares
// (sku, data_pedido) e devolve o CMV de cada um, fazendo 1 query por
// sku_pai distinto em vez de N queries individuais.
export async function getCMVBatch(
  supabase: SupabaseClient,
  items: Array<{ sku: string; data_pedido: Date | string }>,
): Promise<number[]> {
  if (items.length === 0) return [];

  const paisSet = new Set<string>();
  const parsed = items.map(it => {
    const pai = extractSkuPai(it.sku);
    if (pai) paisSet.add(pai);
    return {
      sku_pai: pai,
      tamanho: extractTamanho(it.sku),
      data: toDateOnly(it.data_pedido),
    };
  });

  if (paisSet.size === 0) return items.map(() => 0);

  const { data, error } = await supabase
    .from('sku_custo')
    .select('sku_pai, faixa, tamanhos, custo_unitario, vigencia_inicio, vigencia_fim')
    .in('sku_pai', Array.from(paisSet));

  if (error || !data) return items.map(() => 0);

  const byPai = new Map<string, CustoRow[]>();
  for (const row of data as CustoRow[]) {
    const arr = byPai.get(row.sku_pai) ?? [];
    arr.push(row);
    byPai.set(row.sku_pai, arr);
  }

  return parsed.map(p => {
    if (!p.sku_pai) return 0;
    const all = byPai.get(p.sku_pai) ?? [];
    const valid = all.filter(c =>
      c.vigencia_inicio <= p.data &&
      (c.vigencia_fim === null || c.vigencia_fim >= p.data),
    );
    const chosen = pickCusto(valid, p.tamanho);
    return chosen ? Number(chosen.custo_unitario) : 0;
  });
}

// Mesmo getCMVBatch, mas consulta sku_alias para normalizar o sku_pai antes de
// procurar em sku_custo. Paridade com resolve_cmv_for_sku em SQL (migration 054).
// Regra: o tamanho continua saindo do SKU original — alias reescreve apenas o
// agrupamento (sku_pai).
export async function getCMVBatchWithAlias(
  supabase: SupabaseClient,
  items: Array<{ sku: string; data_pedido: Date | string }>,
): Promise<number[]> {
  if (items.length === 0) return [];

  const parsed = items.map(it => ({
    pai: extractSkuPai(it.sku),
    tamanho: extractTamanho(it.sku),
    data: toDateOnly(it.data_pedido),
  }));

  const paisOriginais = Array.from(new Set(parsed.map(p => p.pai).filter((x): x is string => !!x)));
  if (paisOriginais.length === 0) return items.map(() => 0);

  const aliasMap = await resolveAliasBatch(supabase, paisOriginais);
  const paisCanonicos = parsed.map(p => (p.pai ? aliasMap.get(p.pai) ?? p.pai : null));
  const paisParaQuery = Array.from(new Set(paisCanonicos.filter((x): x is string => !!x)));

  if (paisParaQuery.length === 0) return items.map(() => 0);

  const { data, error } = await supabase
    .from('sku_custo')
    .select('sku_pai, faixa, tamanhos, custo_unitario, vigencia_inicio, vigencia_fim')
    .in('sku_pai', paisParaQuery);

  if (error || !data) return items.map(() => 0);

  const byPai = new Map<string, CustoRow[]>();
  for (const row of data as CustoRow[]) {
    const arr = byPai.get(row.sku_pai) ?? [];
    arr.push(row);
    byPai.set(row.sku_pai, arr);
  }

  return parsed.map((p, i) => {
    const pai = paisCanonicos[i];
    if (!pai) return 0;
    const all = byPai.get(pai) ?? [];
    const valid = all.filter(c =>
      c.vigencia_inicio <= p.data &&
      (c.vigencia_fim === null || c.vigencia_fim >= p.data),
    );
    const chosen = pickCusto(valid, p.tamanho);
    return chosen ? Number(chosen.custo_unitario) : 0;
  });
}
