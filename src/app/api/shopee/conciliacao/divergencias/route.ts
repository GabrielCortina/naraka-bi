import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Lista pedidos em PAGO_COM_DIVERGENCIA para o modal clicável no
// dashboard financeiro. Aceita shop_id=all|<id>. Ordenado por
// |divergencia_valor| desc em JS (PostgREST não tem ordering por ABS).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Row {
  shop_id: number;
  order_sn: string;
  tiny_numero_pedido: string | null;
  valor_bruto_shopee: number | null;
  valor_bruto_tiny: number | null;
  divergencia_valor: number | null;
  divergencia_percentual: number | null;
  observacoes: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const shopIdStr = request.nextUrl.searchParams.get('shop_id') ?? 'all';

    const supabase = createServiceClient();
    let query = supabase
      .from('shopee_conciliacao')
      .select(
        'shop_id, order_sn, tiny_numero_pedido, valor_bruto_shopee, valor_bruto_tiny, divergencia_valor, divergencia_percentual, observacoes',
      )
      .eq('classificacao', 'PAGO_COM_DIVERGENCIA');

    if (shopIdStr !== 'all') {
      const n = Number(shopIdStr);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
      }
      query = query.eq('shop_id', n);
    }

    const { data, error } = await query.limit(2000);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = ((data as Row[] | null) ?? []).sort(
      (a, b) => Math.abs(b.divergencia_valor ?? 0) - Math.abs(a.divergencia_valor ?? 0),
    );

    return NextResponse.json({ pedidos: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
