import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { expandKits, getCMVBatchWithAlias } from '@/lib/cmv';

// Endpoint auxiliar da aba Lucro e Prejuízo — retorna os itens detalhados
// de um pedido (sku, quantidade, descricao, cmv_unitario).
//
// Fontes de itens (mesma ordem de refresh_lucro_pedido_stats):
//   1) shopee_conciliacao.tiny_pedido_id → pedidos → pedido_itens (Tiny)
//   2) pedidos.numero_pedido_ecommerce = order_sn → pedido_itens (Tiny direto)
//   3) shopee_escrow.raw_json->'order_income'->'items' (raw — ~38% dos pedidos)
//
// Pipeline após buscar itens (paridade com rpc_top_skus/rpc_sku_detalhes
// e migration 054 do refresh_lucro_pedido_stats):
//   → expandKits: 1 kit vira N componentes com quantidade multiplicada
//   → getCMVBatchWithAlias: resolve sku_pai via sku_alias antes do custo
//
// GET /api/lucro/pedido-itens?order_sn=X&shop_id=Y

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ItemOut {
  sku: string;
  descricao: string | null;
  quantidade: number;
  cmv_unitario: number;
}

interface RawEscrowItem {
  model_sku?: string | null;
  item_sku?: string | null;
  item_name?: string | null;
  model_name?: string | null;
  quantity_purchased?: number | string | null;
}

type Supabase = ReturnType<typeof createServiceClient>;

// Expande kits e anexa CMV unitário. Entrada: itens brutos com SKU original
// (kit ou não). Saída: itens possivelmente expandidos com cmv_unitario resolvido.
async function normalizeAndResolveCMV(
  supabase: Supabase,
  itens: Array<{ sku: string; descricao: string | null; quantidade: number }>,
  cmvDate: string,
): Promise<ItemOut[]> {
  if (itens.length === 0) return [];

  const expanded = await expandKits(
    supabase,
    itens,
    // Componentes herdam a descricao do kit quando não há nome próprio — a
    // tabela sku_kit não guarda descricao, então preservamos o contexto do kit.
    (orig, comp) => ({
      sku: comp.sku,
      descricao: orig.descricao,
      quantidade: comp.quantidade,
    }),
  );

  const cmvs = await getCMVBatchWithAlias(
    supabase,
    expanded.map(it => ({ sku: it.sku, data_pedido: cmvDate })),
  );

  return expanded.map((it, idx) => ({
    sku: it.sku,
    descricao: it.descricao,
    quantidade: it.quantidade,
    cmv_unitario: cmvs[idx] ?? 0,
  }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderSn = (searchParams.get('order_sn') ?? '').trim();
  const shopIdParam = searchParams.get('shop_id');
  const shopId = Number(shopIdParam);

  if (!orderSn) {
    return NextResponse.json({ error: 'order_sn obrigatório' }, { status: 400 });
  }
  if (!Number.isFinite(shopId) || shopId <= 0) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1) Conciliação
  const { data: conc } = await supabase
    .from('shopee_conciliacao')
    .select('tiny_pedido_id')
    .eq('shop_id', shopId)
    .eq('order_sn', orderSn)
    .maybeSingle();

  let pedidoId: number | null = null;
  if (conc?.tiny_pedido_id != null) pedidoId = Number(conc.tiny_pedido_id);

  // 2) Fallback por numero_pedido_ecommerce
  if (pedidoId == null) {
    const { data: ped } = await supabase
      .from('pedidos')
      .select('id')
      .eq('numero_pedido_ecommerce', orderSn)
      .order('data_pedido', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ped?.id != null) pedidoId = Number(ped.id);
  }

  // Caminho Tiny (1 ou 2)
  if (pedidoId != null) {
    const { data: ped, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, data_pedido')
      .eq('id', pedidoId)
      .maybeSingle();

    if (!pedErr && ped) {
      const { data: itensData, error: itensErr } = await supabase
        .from('pedido_itens')
        .select('sku, descricao, quantidade')
        .eq('pedido_id', pedidoId);

      if (itensErr) {
        return NextResponse.json({ error: itensErr.message }, { status: 500 });
      }

      const itens = (itensData ?? []) as Array<{
        sku: string;
        descricao: string | null;
        quantidade: number | string;
      }>;

      if (itens.length > 0) {
        const normalized = await normalizeAndResolveCMV(
          supabase,
          itens.map(it => ({
            sku: it.sku,
            descricao: it.descricao,
            quantidade: Number(it.quantidade) || 0,
          })),
          ped.data_pedido as string,
        );
        return NextResponse.json({
          itens: normalized,
          source: conc?.tiny_pedido_id ? 'conciliacao' : 'direto',
        });
      }
      // Pedido existe no Tiny mas sem linhas em pedido_itens → cai no raw.
    }
  }

  // 3) Fallback raw_json do escrow
  const { data: escrow, error: escrowErr } = await supabase
    .from('shopee_escrow')
    .select('raw_json, escrow_release_time')
    .eq('shop_id', shopId)
    .eq('order_sn', orderSn)
    .maybeSingle();

  if (escrowErr) {
    return NextResponse.json({ error: escrowErr.message }, { status: 500 });
  }

  if (!escrow) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'none' });
  }

  const rawJson = escrow.raw_json as { order_income?: { items?: RawEscrowItem[] } } | null;
  const rawItems = rawJson?.order_income?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'raw_empty' });
  }

  // Sem data_pedido Tiny nesse caminho — usa release_time como aproximação.
  const cmvDate = escrow.escrow_release_time
    ? String(escrow.escrow_release_time).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const parsed = rawItems
    .map(it => {
      const sku = (it.model_sku && it.model_sku.trim()) || (it.item_sku && it.item_sku.trim()) || '';
      if (!sku) return null;
      const qtd = Number(it.quantity_purchased);
      return {
        sku,
        descricao: it.model_name || it.item_name || null,
        quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
      };
    })
    .filter((x): x is { sku: string; descricao: string | null; quantidade: number } => x !== null);

  if (parsed.length === 0) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'raw_empty' });
  }

  const normalized = await normalizeAndResolveCMV(supabase, parsed, cmvDate);
  return NextResponse.json({ itens: normalized, source: 'raw_json' });
}
