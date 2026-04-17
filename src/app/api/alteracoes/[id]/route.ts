import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ success: false, error: 'id inválido' }, { status: 400 });
  }

  try {
    const db = createServiceClient();
    const { error } = await db
      .from('alteracoes_anuncio')
      .update({ excluido_em: new Date().toISOString() })
      .eq('id', id)
      .is('excluido_em', null);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
