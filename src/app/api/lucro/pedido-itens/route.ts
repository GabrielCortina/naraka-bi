import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getCMVBatch } from '@/lib/cmv';

// Endpoint auxiliar da aba Lucro e Prejuízo — retorna os itens detalhados
// de um pedido (sku, quantidade, descricao, cmv_unitario). Usado pela
// expansão de linha para mostrar o breakdown por SKU.
//
// Resolução dos itens (mesma lógica de refresh_lucro_pedido_stats):
//   1) shopee_conciliacao.tiny_pedido_id → pedidos → pedido_itens
//   2) fallback: pedidos.numero_pedido_ecommerce = order_sn
//
// CMV resolvido via src/lib/cmv.ts (getCMVBatch) — 1 query por sku_pai.
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

  // 1) Tenta conciliação
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

  if (pedidoId == null) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'none' });
  }

  // Busca itens + data_pedido do pedido (para CMV)
  const { data: ped, error: pedErr } = await supabase
    .from('pedidos')
    .select('id, data_pedido')
    .eq('id', pedidoId)
    .maybeSingle();
  if (pedErr || !ped) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'none' });
  }

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

  if (itens.length === 0) {
    return NextResponse.json({ itens: [] as ItemOut[], source: 'empty' });
  }

  // CMV em batch — 1 query por sku_pai distinto.
  const cmvs = await getCMVBatch(
    supabase,
    itens.map(it => ({ sku: it.sku, data_pedido: ped.data_pedido as string })),
  );

  const out: ItemOut[] = itens.map((it, idx) => ({
    sku: it.sku,
    descricao: it.descricao,
    quantidade: Number(it.quantidade) || 0,
    cmv_unitario: cmvs[idx] ?? 0,
  }));

  return NextResponse.json({ itens: out, source: conc?.tiny_pedido_id ? 'conciliacao' : 'direto' });
}
