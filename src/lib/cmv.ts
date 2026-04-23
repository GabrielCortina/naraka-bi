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
