import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { ALLOWED_RPCS, resolveLojaServerSide } from '@/lib/dashboard-rpc-utils';

// API route que executa UMA RPC do dashboard com service_role.
// Para múltiplas RPCs em 1 invocação, ver /api/dashboard/batch.

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface RpcRequestBody {
  rpc?: unknown;
  params?: unknown;
  loja?: unknown;
}

export async function POST(req: NextRequest) {
  let body: RpcRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const rpc = body.rpc;
  if (typeof rpc !== 'string' || !ALLOWED_RPCS.has(rpc)) {
    return NextResponse.json(
      { error: `rpc não permitida: ${String(rpc)}` },
      { status: 400 },
    );
  }

  const params: Record<string, unknown> =
    body.params && typeof body.params === 'object'
      ? { ...(body.params as Record<string, unknown>) }
      : {};

  if (params.p_lojas === undefined) {
    const loja = body.loja;
    if (typeof loja === 'string' && loja !== '') {
      params.p_lojas = await resolveLojaServerSide(loja);
    } else {
      params.p_lojas = null;
    }
  }

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc(rpc, params);

    if (error) {
      console.error(`[api/dashboard/rpc] ${rpc} error:`, error.message);
      return NextResponse.json(
        { error: error.message, data: [] },
        { status: 500 },
      );
    }

    return NextResponse.json({ data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`[api/dashboard/rpc] ${rpc} exception:`, message);
    return NextResponse.json(
      { error: message, data: [] },
      { status: 500 },
    );
  }
}
