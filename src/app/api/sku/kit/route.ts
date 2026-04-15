import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc('rpc_sku_kit_list');
    if (error) {
      return NextResponse.json({ error: error.message, data: [] }, { status: 500 });
    }
    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message, data: [] }, { status: 500 });
  }
}

interface PostBody {
  sku_kit?: unknown;
  sku_componente?: unknown;
  quantidade?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const sku_kit = typeof body.sku_kit === 'string' ? body.sku_kit.trim() : '';
  const sku_componente = typeof body.sku_componente === 'string' ? body.sku_componente.trim() : '';
  const quantidadeRaw = typeof body.quantidade === 'number' ? body.quantidade : Number(body.quantidade);
  const quantidade = Number.isFinite(quantidadeRaw) && quantidadeRaw > 0 ? Math.floor(quantidadeRaw) : 1;

  if (!sku_kit || !sku_componente) {
    return NextResponse.json(
      { error: 'sku_kit e sku_componente são obrigatórios' },
      { status: 400 },
    );
  }
  if (sku_kit === sku_componente) {
    return NextResponse.json(
      { error: 'sku_kit e sku_componente devem ser diferentes' },
      { status: 400 },
    );
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('sku_kit')
      .insert({ sku_kit, sku_componente, quantidade, ativo: true })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface PatchBody {
  id?: unknown;
  ativo?: unknown;
  quantidade?: unknown;
}

export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const id = typeof body.id === 'number' ? body.id : NaN;
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.ativo === 'boolean') update.ativo = body.ativo;
  if (body.quantidade !== undefined) {
    const q = typeof body.quantidade === 'number' ? body.quantidade : Number(body.quantidade);
    if (Number.isFinite(q) && q > 0) update.quantidade = Math.floor(q);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nenhum campo para atualizar' }, { status: 400 });
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('sku_kit')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
