import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc('rpc_sku_alias_list');
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
  sku_original?: unknown;
  canal?: unknown;
  sku_canonico?: unknown;
  observacao?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const sku_original = typeof body.sku_original === 'string' ? body.sku_original.trim() : '';
  const sku_canonico = typeof body.sku_canonico === 'string' ? body.sku_canonico.trim() : '';
  const canal = typeof body.canal === 'string' && body.canal.trim() !== '' ? body.canal.trim() : null;
  const observacao = typeof body.observacao === 'string' && body.observacao.trim() !== '' ? body.observacao.trim() : null;

  if (!sku_original || !sku_canonico) {
    return NextResponse.json(
      { error: 'sku_original e sku_canonico são obrigatórios' },
      { status: 400 },
    );
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('sku_alias')
      .insert({ sku_original, canal, sku_canonico, observacao, ativo: true })
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
  sku_canonico?: unknown;
  observacao?: unknown;
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
  if (typeof body.sku_canonico === 'string' && body.sku_canonico.trim() !== '') {
    update.sku_canonico = body.sku_canonico.trim();
  }
  if (typeof body.observacao === 'string') {
    update.observacao = body.observacao.trim() === '' ? null : body.observacao.trim();
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nenhum campo para atualizar' }, { status: 400 });
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('sku_alias')
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
