import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { ALLOWED_RPCS, resolveLojaServerSide } from '@/lib/dashboard-rpc-utils';

// Executa MÚLTIPLAS RPCs em 1 invocação Vercel.
// Reduz custo (1 fn/refresh em vez de N) e elimina N×roundtrip browser↔Vercel.
// Cada RPC é executada em paralelo via Promise.all server-side.
// Falha de uma RPC NÃO derruba o batch — retorna { error } na posição.

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface BatchCall {
  rpc?: unknown;
  params?: unknown;
  loja?: unknown;
}

interface BatchResultEntry {
  data: unknown[];
  error?: string;
}

export async function POST(req: NextRequest) {
  let body: { calls?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!Array.isArray(body.calls)) {
    return NextResponse.json(
      { error: 'calls must be an array' },
      { status: 400 },
    );
  }

  const calls = body.calls as BatchCall[];

  if (calls.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // Validate todas as RPCs antes de executar qualquer uma.
  for (const c of calls) {
    if (typeof c.rpc !== 'string' || !ALLOWED_RPCS.has(c.rpc)) {
      return NextResponse.json(
        { error: `rpc não permitida: ${String(c.rpc)}` },
        { status: 400 },
      );
    }
  }

  const db = createServiceClient();

  const results: BatchResultEntry[] = await Promise.all(
    calls.map(async (c): Promise<BatchResultEntry> => {
      const rpcName = c.rpc as string;
      const params: Record<string, unknown> =
        c.params && typeof c.params === 'object'
          ? { ...(c.params as Record<string, unknown>) }
          : {};

      if (params.p_lojas === undefined) {
        const loja = c.loja;
        if (typeof loja === 'string' && loja !== '') {
          params.p_lojas = await resolveLojaServerSide(loja);
        } else {
          params.p_lojas = null;
        }
      }

      try {
        const { data, error } = await db.rpc(rpcName, params);
        if (error) {
          console.error(`[api/dashboard/batch] ${rpcName} error:`, error.message);
          return { data: [], error: error.message };
        }
        return { data: (data ?? []) as unknown[] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        console.error(`[api/dashboard/batch] ${rpcName} exception:`, message);
        return { data: [], error: message };
      }
    }),
  );

  return NextResponse.json({ results });
}
