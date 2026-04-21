import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getShopById, shopeeCallWithRefresh, sleep, fmtDMY } from '@/lib/shopee/sync-helpers';

// Rota TEMPORÁRIA: backfill de /api/v2/ads/get_all_cpc_ads_daily_performance
// dia a dia. O sync regular cobre últimos 7 dias; este endpoint puxa um
// intervalo específico (DD-MM-YYYY é o formato BR exigido pela Shopee).
//
// GET /api/shopee/sync/refill-ads?shop_id=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Ref: SHOPEE_API_REFERENCE.md §3.7 e src/app/api/shopee/sync/ads/route.ts.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface DailyPerformance {
  date?: string;
  impression?: number;
  clicks?: number;
  ctr?: number;
  direct_order?: number;
  broad_order?: number;
  direct_conversions?: number;
  broad_conversions?: number;
  direct_item_sold?: number;
  broad_item_sold?: number;
  direct_gmv?: number;
  broad_gmv?: number;
  expense?: number;
  cost_per_conversion?: number;
  direct_roas?: number;
  broad_roas?: number;
}

// Shopee BR devolve array direto no `response`. Outras versões encapsulam
// em { shop_performance.daily_performance } ou { daily_performance }.
type AdsResp =
  | DailyPerformance[]
  | { shop_performance?: { daily_performance?: DailyPerformance[] } }
  | { daily_performance?: DailyPerformance[] };

function extractDaily(resp: AdsResp | undefined): DailyPerformance[] {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if ('shop_performance' in resp && resp.shop_performance?.daily_performance) {
    return resp.shop_performance.daily_performance;
  }
  if ('daily_performance' in resp && resp.daily_performance) {
    return resp.daily_performance;
  }
  return [];
}

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const sp = request.nextUrl.searchParams;
  const shopIdParam = sp.get('shop_id');
  const fromParam = sp.get('from');
  const toParam = sp.get('to');

  if (!shopIdParam || !fromParam || !toParam) {
    return NextResponse.json(
      { error: 'shop_id, from, to obrigatórios (from/to em YYYY-MM-DD)' },
      { status: 400 },
    );
  }
  if (!DATE_RE.test(fromParam) || !DATE_RE.test(toParam)) {
    return NextResponse.json({ error: 'from/to devem ser YYYY-MM-DD' }, { status: 400 });
  }

  const shopId = Number(shopIdParam);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  const shop = await getShopById(shopId);
  if (!shop) {
    return NextResponse.json(
      { error: `shop ${shopId} inativa ou não encontrada` },
      { status: 404 },
    );
  }

  // Itera dia a dia em UTC puro (evita drifts de DST).
  const [fy, fm, fd] = fromParam.split('-').map(Number);
  const [ty, tm, td] = toParam.split('-').map(Number);
  const startMs = Date.UTC(fy, fm - 1, fd);
  const endMs = Date.UTC(ty, tm - 1, td);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return NextResponse.json({ error: 'from/to inválidos' }, { status: 400 });
  }

  const totalDays = Math.round((endMs - startMs) / 86400000) + 1;

  const supabase = createServiceClient();
  let processed = 0;
  let failed = 0;
  let lastDateProcessed: string | null = null;
  let stoppedDate: string | null = null;
  let timedOut = false;
  const failures: Array<{ date: string; error: string }> = [];

  for (let ms = startMs; ms <= endMs; ms += 86400000) {
    if (timeLeft() < 3000) {
      timedOut = true;
      stoppedDate = new Date(ms).toISOString().substring(0, 10);
      break;
    }

    const isoDate = new Date(ms).toISOString().substring(0, 10);
    // fmtDMY espera Unix seconds em UTC; meio-dia UTC garante o dia certo.
    const dmy = fmtDMY(Math.floor(ms / 1000) + 43200);

    try {
      const resp = await shopeeCallWithRefresh<AdsResp>(
        shop,
        '/api/v2/ads/get_all_cpc_ads_daily_performance',
        { start_date: dmy, end_date: dmy },
      );

      const daily = extractDaily(resp.response as AdsResp | undefined);

      // A API pode devolver array vazio em dias sem investimento — isso
      // não é erro. Gravamos uma linha zerada para a data ficar presente.
      const metric = daily[0] ?? {};
      const row = {
        shop_id: shop.shop_id,
        date: isoDate,
        impression: metric.impression ?? 0,
        clicks: metric.clicks ?? 0,
        ctr: metric.ctr ?? 0,
        direct_order: metric.direct_order ?? 0,
        broad_order: metric.broad_order ?? 0,
        direct_conversions: metric.direct_conversions ?? 0,
        broad_conversions: metric.broad_conversions ?? 0,
        direct_item_sold: metric.direct_item_sold ?? 0,
        broad_item_sold: metric.broad_item_sold ?? 0,
        direct_gmv: metric.direct_gmv ?? 0,
        broad_gmv: metric.broad_gmv ?? 0,
        expense: metric.expense ?? 0,
        cost_per_conversion: metric.cost_per_conversion ?? 0,
        direct_roas: metric.direct_roas ?? 0,
        broad_roas: metric.broad_roas ?? 0,
        synced_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('shopee_ads_daily')
        .upsert(row, { onConflict: 'shop_id,date' });
      if (error) throw new Error(`UPSERT: ${error.message}`);

      processed++;
      lastDateProcessed = isoDate;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'unknown';
      failures.push({ date: isoDate, error: msg.substring(0, 200) });
      console.warn(`[shopee-sync][refill-ads] shop_id=${shopId} date=${isoDate} falhou:`, msg);
    }

    await sleep(THROTTLE_MS);
  }

  console.log(
    `[shopee-sync][refill-ads] shop_id=${shopId} total=${totalDays} processed=${processed} failed=${failed} last=${lastDateProcessed} timed_out=${timedOut}`,
  );

  return NextResponse.json({
    shop_id: shopId,
    window: { from: fromParam, to: toParam },
    total_days: totalDays,
    processed,
    failed,
    last_date_processed: lastDateProcessed,
    stopped_date: stoppedDate,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
    failures: failures.slice(0, 20),
  });
}
