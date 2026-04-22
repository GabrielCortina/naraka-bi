import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Resolve pedidos em PAGO_COM_DIVERGENCIA. Ação 'confirmar_ok' marca
// manualmente como OK (o cron vai respeitar esse override porque o
// /api/shopee/sync/reconciliation pula pedidos com "Confirmado
// manualmente" em observacoes). Ação 'manter_divergencia' só anota a
// revisão humana — classificação e valores continuam como estão.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MARCADOR_CONFIRMADO = 'Confirmado manualmente';
const MARCADOR_MANTIDO = 'Divergência confirmada';

interface Body {
  order_sn?: unknown;
  shop_id?: unknown;
  acao?: unknown;
  observacao?: unknown;
}

function appendObservacao(atual: string | null, novo: string): string {
  const clean = (atual ?? '').trim();
  if (!clean) return novo;
  return `${clean} | ${novo}`;
}

function formatBRDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;

    const order_sn = typeof body.order_sn === 'string' ? body.order_sn.trim() : '';
    if (!order_sn) {
      return NextResponse.json({ error: 'order_sn é obrigatório' }, { status: 400 });
    }

    const shopIdNum = Number(body.shop_id);
    if (!Number.isFinite(shopIdNum) || shopIdNum <= 0) {
      return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
    }

    const acao = typeof body.acao === 'string' ? body.acao : '';
    if (acao !== 'confirmar_ok' && acao !== 'manter_divergencia') {
      return NextResponse.json({ error: 'acao inválida' }, { status: 400 });
    }

    const observacao = typeof body.observacao === 'string' ? body.observacao.trim() : '';

    const supabase = createServiceClient();

    // Busca observacoes atuais — o UPDATE precisa concatenar, e o
    // client Supabase não suporta expressão SQL crua.
    const { data: existing, error: errSel } = await supabase
      .from('shopee_conciliacao')
      .select('observacoes')
      .eq('shop_id', shopIdNum)
      .eq('order_sn', order_sn)
      .single();

    if (errSel) {
      const code = errSel.code === 'PGRST116' ? 404 : 500;
      return NextResponse.json({ error: errSel.message }, { status: code });
    }

    const hoje = formatBRDate(new Date());
    const observacoesAtuais = (existing?.observacoes as string | null) ?? null;

    let patch: Record<string, unknown>;
    if (acao === 'confirmar_ok') {
      const marca = observacao
        ? `${MARCADOR_CONFIRMADO} em ${hoje}: ${observacao}`
        : `${MARCADOR_CONFIRMADO} em ${hoje}`;
      patch = {
        classificacao: 'PAGO_OK',
        classificacao_severidade: 'success',
        observacoes: appendObservacao(observacoesAtuais, marca),
      };
    } else {
      const marca = observacao
        ? `${MARCADOR_MANTIDO} em ${hoje}: ${observacao}`
        : `${MARCADOR_MANTIDO} em ${hoje}`;
      patch = {
        observacoes: appendObservacao(observacoesAtuais, marca),
      };
    }

    const { error: errUpd } = await supabase
      .from('shopee_conciliacao')
      .update(patch)
      .eq('shop_id', shopIdNum)
      .eq('order_sn', order_sn);

    if (errUpd) {
      return NextResponse.json({ error: errUpd.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
