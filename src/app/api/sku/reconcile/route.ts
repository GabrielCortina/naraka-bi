import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Chama reconcile_sku_daily_stats() para reaplicar regras de kit/alias
// retroativamente ao summary dashboard_sku_daily_stats.
// Usado pelo modal de Mapeamento de SKU/Kits após cadastrar regra nova.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface PostBody {
  days_back?: unknown;
}

export async function POST(req: Request) {
  let body: PostBody = {};
  try {
    body = await req.json();
  } catch {
    // body opcional
  }

  const raw = typeof body.days_back === 'number' ? body.days_back : Number(body.days_back);
  const days_back = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 400) : 30;

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc('reconcile_sku_daily_stats', { p_days_back: days_back });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const processed = Array.isArray(data) ? data.length : 0;
    return NextResponse.json({ data: { processed, days_back } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
