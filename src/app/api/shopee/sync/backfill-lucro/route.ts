import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// Backfill do summary de lucro por pedido. Chama refresh_lucro_pedido_stats
// dia a dia para uma janela (from, to) e um shop_id. Budget de 45s —
// retorna parcial se o tempo acabar; o chamador pode retomar chamando
// novamente com `from = último dia processado + 1`.
//
// Uso:
//   GET /api/shopee/sync/backfill-lucro?shop_id=123&from=2026-03-01&to=2026-04-23
//
// O handler é idempotente: cada dia é um UPSERT na tabela.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

interface DayResult {
  date: string;
  status: 'ok' | 'error';
  error?: string;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const { searchParams } = new URL(request.url);
  const shopIdParam = searchParams.get('shop_id');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  const shopId = Number(shopIdParam);
  if (!Number.isFinite(shopId) || shopId <= 0) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ error: 'from/to obrigatórios em YYYY-MM-DD' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'from deve ser ≤ to' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const results: DayResult[] = [];
  const pending: string[] = [];

  // Processa do mais recente ao mais antigo — valores recentes têm prioridade.
  const dates: string[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) dates.push(d);

  for (const date of dates) {
    if (timeLeft() < 3000) {
      pending.push(date);
      continue;
    }
    const { error } = await supabase.rpc('refresh_lucro_pedido_stats', {
      p_data: date,
      p_shop_id: shopId,
    });
    if (error) {
      results.push({ date, status: 'error', error: error.message });
      console.error(`[shopee-sync][backfill-lucro] shop_id=${shopId} date=${date} ERRO:`, error.message);
    } else {
      results.push({ date, status: 'ok' });
    }
  }

  const status: 'success' | 'partial' | 'error' =
    pending.length > 0 ? 'partial'
    : results.every(r => r.status === 'error') ? 'error'
    : results.some(r => r.status === 'error') ? 'partial'
    : 'success';

  return NextResponse.json({
    job: 'backfill_lucro',
    shop_id: shopId,
    from,
    to,
    status,
    days_processed: results,
    days_pending: pending,
    duration_ms: Date.now() - startedAt,
  });
}
