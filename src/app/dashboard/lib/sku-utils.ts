import type { SkuPaiAgrupado } from '../types';

// Extrai o SKU pai (apenas dígitos iniciais)
// 60906P-GG → 60906, 1007-42 → 1007, 20814P-G → 20814
export function extrairSkuPai(sku: string): string {
  const match = sku.match(/^(\d+)/);
  return match ? match[1] : sku;
}

// Agrupa itens por SKU pai, somando quantidade e valor
export function agruparPorSkuPai(
  itens: { sku: string; quantidade: number; valor_total: number }[]
): SkuPaiAgrupado[] {
  const mapa = new Map<string, { variacoes: Set<string>; faturamento: number; quantidade: number }>();

  for (const item of itens) {
    const pai = extrairSkuPai(item.sku);
    const grupo = mapa.get(pai) || { variacoes: new Set(), faturamento: 0, quantidade: 0 };
    grupo.variacoes.add(item.sku);
    grupo.faturamento += item.valor_total;
    grupo.quantidade += item.quantidade;
    mapa.set(pai, grupo);
  }

  return Array.from(mapa.entries()).map(([skuPai, grupo]) => ({
    skuPai,
    variacoes: Array.from(grupo.variacoes).sort(),
    faturamentoTotal: grupo.faturamento,
    quantidadeTotal: grupo.quantidade,
  }));
}
