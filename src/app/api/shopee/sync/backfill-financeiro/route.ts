import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopById } from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit } from '@/lib/shopee/audit';

// Backfill manual do summary financeiro diário. Rodar UMA vez por loja
// após a Etapa 1 para popular histórico — depois o cron refresh-financeiro
// mantém atualizado.
//
// GET /api/shopee/sync/backfill-financeiro?shop_id=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Budget de 45s. Se estourar, retorna parcial com stopped_date — basta
// re-chamar com from = stopped_date para continuar.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'backfill_financeiro';
const MAX_ELAPSED_MS = 45 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function buildDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) {
    dates.push(cur);
    cur = addDays(cur, 1);
  }
  return dates;
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const sp = request.nextUrl.searchParams;
  const shopIdStr = sp.get('shop_id');
  const from = sp.get('from');
  const to = sp.get('to');

  if (!shopIdStr || !from || !to) {
    return NextResponse.json(
      { error: 'params obrigatórios: shop_id, from (YYYY-MM-DD), to (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  const shopId = Number(shopIdStr);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'from/to devem ser YYYY-MM-DD' }, { status: 400 });
  }

  if (to < from) {
    return NextResponse.json({ error: 'to deve ser >= from' }, { status: 400 });
  }

  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json({ error: `shop_id ${shopId} não encontrado ou inativo` }, { status: 404 });
  }

  const dates = buildDateRange(from, to);
  const total = dates.length;

  const supabase = createServiceClient();
  const auditId = await startAudit({
    shop_id: shopId,
    job_name: JOB_NAME,
    window_from: `${from}T03:00:00Z`,
    window_to: `${addDays(to, 1)}T03:00:00Z`,
  });

  let processed = 0;
  let failed = 0;
  let lastDateProcessed: string | null = null;
  let stoppedDate: string | null = null;
  let timedOut = false;
  const errors: Array<{ date: string; error: string }> = [];

  for (const date of dates) {
    if (timeLeft() < 3000) {
      timedOut = true;
      stoppedDate = date;
      break;
    }

    const { error } = await supabase.rpc('refresh_shopee_financeiro_daily', {
      p_data: date,
      p_shop_id: shopId,
    });

    if (error) {
      failed++;
      errors.push({ date, error: error.message });
      console.error(
        `[shopee-sync][backfill-financeiro] shop_id=${shopId} date=${date} ERRO:`,
        error.message,
      );
    } else {
      processed++;
      lastDateProcessed = date;
    }
  }

  const status: 'success' | 'partial' | 'error' =
    timedOut ? 'partial'
    : failed > 0 && processed === 0 ? 'error'
    : failed > 0 ? 'partial'
    : 'success';

  await finishAudit(
    auditId,
    status,
    {
      rows_updated: processed,
      errors_count: failed,
      error_message: errors[0]?.error,
      metadata: {
        total_days: total,
        last_date_processed: lastDateProcessed,
        stopped_date: stoppedDate,
        timed_out: timedOut,
      },
    },
    startedAt,
  );

  console.log(
    `[shopee-sync][backfill-financeiro] shop_id=${shopId} from=${from} to=${to} total=${total} ok=${processed} fail=${failed} timeout=${timedOut}`,
  );

  return NextResponse.json({
    shop_id: shopId,
    window: { from, to },
    total_days: total,
    processed,
    failed,
    last_date_processed: lastDateProcessed,
    stopped_date: stoppedDate,
    timed_out: timedOut,
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: Date.now() - startedAt,
  });
}
