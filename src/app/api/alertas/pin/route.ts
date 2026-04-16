import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PostBody {
  sku_pai?: unknown;
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const sku_pai = typeof body.sku_pai === 'string' ? body.sku_pai.trim() : '';
  if (!sku_pai) {
    return NextResponse.json({ error: 'sku_pai obrigatório' }, { status: 400 });
  }

  try {
    const db = createServiceClient();

    const { data: existing } = await db
      .from('sku_pin')
      .select('id')
      .eq('sku_pai', sku_pai)
      .maybeSingle();

    if (existing) {
      await db.from('sku_pin').delete().eq('id', existing.id);
      return NextResponse.json({ success: true, action: 'unpinned' });
    }

    await db.from('sku_pin').insert({ sku_pai });
    return NextResponse.json({ success: true, action: 'pinned' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
