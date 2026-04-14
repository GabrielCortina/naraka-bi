import { createBrowserClient } from '@/lib/supabase-browser';
import { SITUACOES_APROVADAS, SITUACOES_CANCELADAS } from '../types';
import type {
  ResumoHero, VendaDia, LojaRanking, HeatmapCell,
  ComparativoPeriodo, HistoricoDia,
} from '../types';
import {
  getPeriodoAnterior, diasNoRange, diasRestantesMes,
  periodoIncluiMesAtual, calcVariacao,
} from './date-utils';
import { agruparPorSkuPai } from './sku-utils';
import type { DateRange, KpisSecundarios, SkuPaiAgrupado, SkuDetalhe, MarketplaceData } from '../types';

function supabase() {
  return createBrowserClient();
}

// Supabase .in() tem limite de URL (~8KB no nginx/PostgREST).
// Com IDs BIGINT da Tiny (~12 dígitos), 500 IDs geram URL de ~7KB e
// esbarram no limite quando combinados com headers/auth, causando 500.
// 200 IDs mantém a URL em ~2.8KB, bem abaixo do limite.
const BATCH_SIZE = 200;
async function batchIn<T>(
  table: string,
  column: string,
  ids: number[],
  selectFields: string,
): Promise<T[]> {
  const db = supabase();
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { data } = await db.from(table).select(selectFields).in(column, chunk);
    if (data) results.push(...(data as T[]));
  }
  return results;
}

// Supabase retorna max 1000 rows por padrão — pagina para buscar tudo
const PAGE_SIZE = 1000;
async function fetchAllPedidos<T>(
  selectFields: string,
  situacoes: number[],
  start: string,
  end: string,
  loja?: string,
): Promise<T[]> {
  const db = supabase();
  const results: T[] = [];
  let offset = 0;
  while (true) {
    let query = db.from('pedidos')
      .select(selectFields)
      .in('situacao', situacoes)
      .gte('data_pedido', start)
      .lte('data_pedido', end)
      .range(offset, offset + PAGE_SIZE - 1);
    if (loja) query = query.eq('ecommerce_nome', loja);
    const { data } = await query;
    if (!data || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return results;
}

// ============================================================
// RESUMO HERO — 4 KPIs principais + período anterior
// ============================================================
export async function getResumoHero(
  startDate: string, endDate: string, loja?: string
): Promise<ResumoHero> {
  const range: DateRange = { start: startDate, end: endDate };
  const anterior = getPeriodoAnterior(range);

  const [atual, prev, pecasAtual, pecasPrev] = await Promise.all([
    fetchResumo(startDate, endDate, loja),
    fetchResumo(anterior.start, anterior.end, loja),
    fetchPecas(startDate, endDate, loja),
    fetchPecas(anterior.start, anterior.end, loja),
  ]);

  return {
    faturamento: atual.faturamento,
    pedidos: atual.pedidos,
    ticketMedio: atual.pedidos > 0 ? atual.faturamento / atual.pedidos : 0,
    pecasVendidas: pecasAtual,
    faturamentoAnterior: prev.faturamento,
    pedidosAnterior: prev.pedidos,
    ticketMedioAnterior: prev.pedidos > 0 ? prev.faturamento / prev.pedidos : 0,
    pecasAnterior: pecasPrev,
  };
}

async function fetchResumo(start: string, end: string, loja?: string) {
  const rows = await fetchAllPedidos<{ valor_total_pedido: number; id: number }>(
    'valor_total_pedido, id', SITUACOES_APROVADAS, start, end, loja
  );
  return {
    faturamento: rows.reduce((sum, r) => sum + (r.valor_total_pedido || 0), 0),
    pedidos: rows.length,
  };
}

async function fetchPecas(start: string, end: string, loja?: string) {
  const pedidos = await fetchAllPedidos<{ id: number }>(
    'id', SITUACOES_APROVADAS, start, end, loja
  );
  if (pedidos.length === 0) return 0;

  const ids = pedidos.map(p => p.id);
  const itens = await batchIn<{ quantidade: number }>('pedido_itens', 'pedido_id', ids, 'quantidade');

  return itens.reduce((sum, i) => sum + (i.quantidade || 0), 0);
}

// ============================================================
// KPIs SECUNDÁRIOS
// ============================================================
export async function getKpisSecundarios(
  startDate: string, endDate: string, loja?: string
): Promise<KpisSecundarios> {
  const range: DateRange = { start: startDate, end: endDate };
  const dias = diasNoRange(range);

  const [vendasDia, cancelados] = await Promise.all([
    getVendasPorDia(startDate, endDate, loja),
    fetchCancelados(startDate, endDate, loja),
  ]);

  const fatTotal = vendasDia.reduce((s, d) => s + d.faturamento, 0);
  const pecasTotal = vendasDia.reduce((s, d) => s + d.pecas, 0);
  const mediaDiariaRs = dias > 0 ? fatTotal / dias : 0;
  const mediaDiariaPecas = dias > 0 ? pecasTotal / dias : 0;

  // Melhor dia
  const melhorDia = vendasDia.reduce(
    (best, d) => d.faturamento > best.valor ? { data: d.data, valor: d.faturamento } : best,
    { data: '', valor: 0 }
  );

  // Projeção do mês
  let projecaoMesRs: number | null = null;
  let projecaoMesPecas: number | null = null;
  if (periodoIncluiMesAtual(range)) {
    const restantes = diasRestantesMes();
    projecaoMesRs = fatTotal + mediaDiariaRs * restantes;
    projecaoMesPecas = pecasTotal + mediaDiariaPecas * restantes;
  }

  return {
    mediaDiariaRs,
    melhorDia,
    projecaoMesRs,
    mediaDiariaPecas,
    projecaoMesPecas,
    cancelamentos: cancelados.count,
    valorCancelado: cancelados.valor,
  };
}

async function fetchCancelados(start: string, end: string, loja?: string) {
  const rows = await fetchAllPedidos<{ valor_total_pedido: number }>(
    'valor_total_pedido', SITUACOES_CANCELADAS, start, end, loja
  );
  return {
    count: rows.length,
    valor: rows.reduce((s, r) => s + (r.valor_total_pedido || 0), 0),
  };
}

// ============================================================
// VENDAS POR DIA
// ============================================================
export async function getVendasPorDia(
  startDate: string, endDate: string, loja?: string
): Promise<VendaDia[]> {
  const pedidos = await fetchAllPedidos<{ id: number; data_pedido: string; valor_total_pedido: number }>(
    'id, data_pedido, valor_total_pedido', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  // Busca peças
  const ids = pedidos.map(p => p.id);
  const itens = await batchIn<{ pedido_id: number; quantidade: number }>('pedido_itens', 'pedido_id', ids, 'pedido_id, quantidade');

  const pecasPorPedido = new Map<number, number>();
  for (const item of itens) {
    pecasPorPedido.set(item.pedido_id, (pecasPorPedido.get(item.pedido_id) || 0) + (item.quantidade || 0));
  }

  // Agrupa por dia
  const mapa = new Map<string, VendaDia>();
  for (const p of pedidos) {
    const dia = p.data_pedido;
    const entry = mapa.get(dia) || { data: dia, faturamento: 0, pedidos: 0, pecas: 0 };
    entry.faturamento += p.valor_total_pedido || 0;
    entry.pedidos += 1;
    entry.pecas += pecasPorPedido.get(p.id) || 0;
    mapa.set(dia, entry);
  }

  return Array.from(mapa.values()).sort((a, b) => a.data.localeCompare(b.data));
}

// ============================================================
// TOP SKUs
// ============================================================
export async function getTopSkus(
  startDate: string, endDate: string, loja?: string, orderBy: 'faturamento' | 'quantidade' = 'faturamento'
): Promise<SkuPaiAgrupado[]> {
  const pedidos = await fetchAllPedidos<{ id: number }>(
    'id', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  const ids = pedidos.map(p => p.id);
  const itens = await batchIn<{ sku: string; quantidade: number; valor_total: number }>('pedido_itens', 'pedido_id', ids, 'sku, quantidade, valor_total');

  if (itens.length === 0) return [];

  const agrupados = agruparPorSkuPai(itens);
  agrupados.sort((a, b) =>
    orderBy === 'faturamento'
      ? b.faturamentoTotal - a.faturamentoTotal
      : b.quantidadeTotal - a.quantidadeTotal
  );

  return agrupados;
}

// ============================================================
// SKU DETALHES (para modal)
// ============================================================
export async function getSkuDetalhes(
  skuPai: string, startDate: string, endDate: string, loja?: string
): Promise<SkuDetalhe[]> {
  const db = supabase();
  const pedidos = await fetchAllPedidos<{ id: number }>(
    'id', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  const ids = pedidos.map(p => p.id);
  // Batch + filtro like no SKU pai
  const itens: { sku: string; descricao: string; quantidade: number; valor_total: number }[] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const { data } = await db.from('pedido_itens')
      .select('sku, descricao, quantidade, valor_total')
      .in('pedido_id', chunk)
      .like('sku', `${skuPai}%`);
    if (data) itens.push(...data);
  }

  if (itens.length === 0) return [];

  // Agrupa por SKU individual
  const mapa = new Map<string, { descricao: string; quantidade: number; faturamento: number }>();
  for (const item of itens) {
    const entry = mapa.get(item.sku) || { descricao: item.descricao, quantidade: 0, faturamento: 0 };
    entry.quantidade += item.quantidade || 0;
    entry.faturamento += item.valor_total || 0;
    mapa.set(item.sku, entry);
  }

  const totalFat = Array.from(mapa.values()).reduce((s, v) => s + v.faturamento, 0);

  return Array.from(mapa.entries())
    .map(([sku, v]) => ({
      sku,
      descricao: v.descricao,
      quantidade: v.quantidade,
      faturamento: v.faturamento,
      percentual: totalFat > 0 ? (v.faturamento / totalFat) * 100 : 0,
    }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

// ============================================================
// RANKING LOJAS
// ============================================================
export async function getRankingLojas(
  startDate: string, endDate: string, loja?: string
): Promise<LojaRanking[]> {
  const pedidos = await fetchAllPedidos<{ id: number; ecommerce_nome: string; valor_total_pedido: number }>(
    'id, ecommerce_nome, valor_total_pedido', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  const ids = pedidos.map(p => p.id);
  const itens = await batchIn<{ pedido_id: number; quantidade: number }>('pedido_itens', 'pedido_id', ids, 'pedido_id, quantidade');

  const pecasPorPedido = new Map<number, number>();
  for (const item of itens) {
    pecasPorPedido.set(item.pedido_id, (pecasPorPedido.get(item.pedido_id) || 0) + (item.quantidade || 0));
  }

  const mapa = new Map<string, LojaRanking>();
  for (const p of pedidos) {
    const nome = p.ecommerce_nome || 'Sem loja';
    const entry = mapa.get(nome) || { loja: nome, faturamento: 0, pecas: 0, pedidos: 0 };
    entry.faturamento += p.valor_total_pedido || 0;
    entry.pedidos += 1;
    entry.pecas += pecasPorPedido.get(p.id) || 0;
    mapa.set(nome, entry);
  }

  return Array.from(mapa.values()).sort((a, b) => b.faturamento - a.faturamento);
}

// ============================================================
// VENDAS POR MARKETPLACE
// Usa loja_config para mapear ecommerce_nome → marketplace
// ============================================================
const MARKETPLACE_LABELS: Record<string, string> = {
  mercado_livre: 'Mercado Livre',
  shopee: 'Shopee',
  tiktok: 'TikTok Shop',
  shein: 'Shein',
};

const MARKETPLACE_CORES: Record<string, string> = {
  mercado_livre: '#378ADD',
  shopee: '#EF9F27',
  tiktok: '#1D9E75',
  shein: '#D4537E',
};

export async function getVendasPorMarketplace(
  startDate: string, endDate: string, loja?: string
): Promise<MarketplaceData[]> {
  const db = supabase();

  // Carrega mapa de loja_config: ecommerce_nome_tiny → marketplace
  const { data: configs } = await db.from('loja_config').select('ecommerce_nome_tiny, marketplace');
  const configMap = new Map<string, string>();
  for (const c of (configs || [])) {
    configMap.set(c.ecommerce_nome_tiny, c.marketplace);
  }

  const pedidos = await fetchAllPedidos<{ ecommerce_nome: string; valor_total_pedido: number }>(
    'ecommerce_nome, valor_total_pedido', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  // Agrupa por marketplace do loja_config (ou 'outro' se não configurada)
  const mapa = new Map<string, number>();
  let total = 0;
  for (const p of pedidos) {
    const mpKey = configMap.get(p.ecommerce_nome || '') || 'outro';
    mapa.set(mpKey, (mapa.get(mpKey) || 0) + (p.valor_total_pedido || 0));
    total += p.valor_total_pedido || 0;
  }

  return Array.from(mapa.entries())
    .map(([key, faturamento]) => ({
      marketplace: MARKETPLACE_LABELS[key] || 'Outro',
      faturamento,
      percentual: total > 0 ? (faturamento / total) * 100 : 0,
      cor: MARKETPLACE_CORES[key] || '#888888',
    }))
    .sort((a, b) => b.faturamento - a.faturamento);
}

// ============================================================
// HEATMAP DE HORÁRIOS
// Converte last_sync_at de UTC para America/Sao_Paulo (UTC-3)
// ============================================================
export async function getHeatmapHorarios(
  startDate: string, endDate: string, loja?: string
): Promise<HeatmapCell[]> {
  const pedidos = await fetchAllPedidos<{ last_sync_at: string }>(
    'last_sync_at', SITUACOES_APROVADAS, startDate, endDate, loja
  );
  if (pedidos.length === 0) return [];

  const mapa = new Map<string, number>();
  for (const p of pedidos) {
    if (!p.last_sync_at) continue;
    // Converter UTC para America/Sao_Paulo (UTC-3)
    const utc = new Date(p.last_sync_at);
    const sp = new Date(utc.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const key = `${sp.getDay()}-${sp.getHours()}`;
    mapa.set(key, (mapa.get(key) || 0) + 1);
  }

  return Array.from(mapa.entries()).map(([key, total]) => {
    const [dia, hora] = key.split('-').map(Number);
    return { diaSemana: dia, hora, totalPedidos: total };
  });
}

// ============================================================
// COMPARATIVO PERÍODO A PERÍODO (independente do filtro)
// 3 linhas: Semana atual, Mês atual, Quinzena atual
// Comparação: mesmo número de dias do período anterior
// ============================================================
export async function getComparativoPeriodos(): Promise<ComparativoPeriodo[]> {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const dow = now.getDay(); // 0=Dom

  const fmt = (dt: Date) => dt.toISOString().split('T')[0];
  const fmtRange = (s: string, e: string) => {
    const sd = new Date(s + 'T12:00:00');
    const ed = new Date(e + 'T12:00:00');
    return `${String(sd.getDate()).padStart(2, '0')}/${String(sd.getMonth() + 1).padStart(2, '0')} – ${String(ed.getDate()).padStart(2, '0')}/${String(ed.getMonth() + 1).padStart(2, '0')}`;
  };

  // SEMANA ATUAL: seg até hoje
  const inicioSemana = new Date(y, m, d - (dow === 0 ? 6 : dow - 1));
  const fimSemana = now;
  // Período anterior: mesmo dia da semana passada (seg até mesmo dow)
  const inicioSemAnt = new Date(inicioSemana.getTime() - 7 * 86400000);
  const fimSemAnt = new Date(fimSemana.getTime() - 7 * 86400000);

  // MÊS ATUAL: dia 1 até hoje
  const inicioMes = new Date(y, m, 1);
  // Mês anterior mesmo dia: dia 1 até dia d do mês anterior
  const inicioMesAnt = new Date(y, m - 1, 1);
  const fimMesAnt = new Date(y, m - 1, d);

  // QUINZENA ATUAL
  const diaQuinzena = d <= 15 ? 1 : 16;
  const diaRelativo = d <= 15 ? d : d - 15; // dia dentro da quinzena
  const inicioQuinz = new Date(y, m, diaQuinzena);
  // Quinzena anterior mesmo dia relativo
  let inicioQuinzAnt: Date;
  let fimQuinzAnt: Date;
  if (d <= 15) {
    // Estamos na 1ª quinzena → comparar com 2ª quinzena do mês anterior (16 até 16+diaRelativo-1)
    inicioQuinzAnt = new Date(y, m - 1, 16);
    fimQuinzAnt = new Date(y, m - 1, 16 + diaRelativo - 1);
  } else {
    // Estamos na 2ª quinzena → comparar com 1ª quinzena deste mês (1 até diaRelativo)
    inicioQuinzAnt = new Date(y, m, 1);
    fimQuinzAnt = new Date(y, m, diaRelativo);
  }

  async function fat(start: string, end: string): Promise<number> {
    const { data } = await supabase().from('pedidos')
      .select('valor_total_pedido')
      .in('situacao', SITUACOES_APROVADAS)
      .gte('data_pedido', start)
      .lte('data_pedido', end);
    return (data || []).reduce((s, r) => s + (r.valor_total_pedido || 0), 0);
  }

  const [semAtual, semAntVal, mesAtual, mesAntVal, quinzAtual, quinzAntVal] = await Promise.all([
    fat(fmt(inicioSemana), fmt(fimSemana)),
    fat(fmt(inicioSemAnt), fmt(fimSemAnt)),
    fat(fmt(inicioMes), fmt(now)),
    fat(fmt(inicioMesAnt), fmt(fimMesAnt)),
    fat(fmt(inicioQuinz), fmt(now)),
    fat(fmt(inicioQuinzAnt), fmt(fimQuinzAnt)),
  ]);

  return [
    {
      nome: 'Semana atual',
      dateRange: fmtRange(fmt(inicioSemana), fmt(now)),
      valor: semAtual,
      valorComparado: semAntVal,
      variacao: calcVariacao(semAtual, semAntVal),
    },
    {
      nome: 'Mês atual',
      dateRange: fmtRange(fmt(inicioMes), fmt(now)),
      valor: mesAtual,
      valorComparado: mesAntVal,
      variacao: calcVariacao(mesAtual, mesAntVal),
    },
    {
      nome: 'Quinzena atual',
      dateRange: fmtRange(fmt(inicioQuinz), fmt(now)),
      valor: quinzAtual,
      valorComparado: quinzAntVal,
      variacao: calcVariacao(quinzAtual, quinzAntVal),
    },
  ];
}

// ============================================================
// HISTÓRICO POR DIA
// ============================================================
export async function getHistoricoDias(
  startDate: string, endDate: string, loja?: string
): Promise<HistoricoDia[]> {
  const [vendas, cancelados] = await Promise.all([
    getVendasPorDia(startDate, endDate, loja),
    fetchCanceladosPorDia(startDate, endDate, loja),
  ]);

  const cancelMap = new Map(cancelados.map(c => [c.data, c]));

  return vendas.map(v => {
    const c = cancelMap.get(v.data) || { cancelamentos: 0, fatCancelado: 0 };
    return {
      data: v.data,
      faturamento: v.faturamento,
      pedidos: v.pedidos,
      pecas: v.pecas,
      ticketMedio: v.pedidos > 0 ? v.faturamento / v.pedidos : 0,
      cancelamentos: c.cancelamentos,
      fatCancelado: c.fatCancelado,
    };
  }).sort((a, b) => b.data.localeCompare(a.data));
}

async function fetchCanceladosPorDia(start: string, end: string, loja?: string) {
  const data = await fetchAllPedidos<{ data_pedido: string; valor_total_pedido: number }>(
    'data_pedido, valor_total_pedido', SITUACOES_CANCELADAS, start, end, loja
  );
  const mapa = new Map<string, { cancelamentos: number; fatCancelado: number }>();
  for (const r of data) {
    const entry = mapa.get(r.data_pedido) || { cancelamentos: 0, fatCancelado: 0 };
    entry.cancelamentos += 1;
    entry.fatCancelado += r.valor_total_pedido || 0;
    mapa.set(r.data_pedido, entry);
  }
  return Array.from(mapa.entries()).map(([data, v]) => ({ data, ...v }));
}
