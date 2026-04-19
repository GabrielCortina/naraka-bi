import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  resolveTargetShop,
  shopeeCallWithRefresh,
  sleep,
  fmtDMY,
  updateCheckpoint,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync Ads daily (últimos 7 dias). Uma loja por execução — round-robin.
// ⚠️ BR exige DD-MM-YYYY em start_date/end_date. Ref: SHOPEE_API_REFERENCE.md §3.7.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'sync_ads';
const MAX_ELAPSED_MS = 45 * 1000;
const THROTTLE_MS = 300;
const LOOKBACK_DAYS = 7;

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
// Shopee BR retorna response como ARRAY direto: { response: [ {...}, {...} ] }.
// Outras regiões/versões devolvem `{ daily_performance: [...] }` ou
// `{ shop_performance: { daily_performance: [...] } }`. Testamos os três formatos.
type AdsResp =
  | DailyPerformance[]
  | { shop_performance?: { daily_performance?: DailyPerformance[] } }
  | { daily_performance?: DailyPerformance[] };

type StoppedReason = 'complete' | 'timeout' | 'no_shops';

function normalizeDate(d: string | undefined): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

async function runOneShop(shop: ActiveShop) {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - LOOKBACK_DAYS * 86400;

    if (elapsed() > MAX_ELAPSED_MS) {
      return {
        job: JOB_NAME, shop_id: shop.shop_id, processed: 0,
        duration_ms: elapsed(), stopped_reason: 'timeout' as StoppedReason, next_cursor: null,
      };
    }

    const resp = await shopeeCallWithRefresh<AdsResp>(
      shop,
      '/api/v2/ads/get_all_cpc_ads_daily_performance',
      { start_date: fmtDMY(fromSec), end_date: fmtDMY(nowSec) },
    );
    await sleep(THROTTLE_MS);

    // Parsing defensivo: aceita array direto (BR) ou objetos aninhados (outras regiões).
    const rawResp = resp.response as AdsResp | undefined;
    const daily: DailyPerformance[] = Array.isArray(rawResp)
      ? rawResp
      : (rawResp && 'shop_performance' in rawResp && rawResp.shop_performance?.daily_performance) ||
        (rawResp && 'daily_performance' in rawResp && rawResp.daily_performance) ||
        [];

    const supabase = createServiceClient();
    const rows = daily
      .map(d => ({
        shop_id: shop.shop_id,
        date: normalizeDate(d.date),
        impression: d.impression ?? 0,
        clicks: d.clicks ?? 0,
        ctr: d.ctr ?? 0,
        direct_order: d.direct_order ?? 0,
        broad_order: d.broad_order ?? 0,
        direct_conversions: d.direct_conversions ?? 0,
        broad_conversions: d.broad_conversions ?? 0,
        direct_item_sold: d.direct_item_sold ?? 0,
        broad_item_sold: d.broad_item_sold ?? 0,
        direct_gmv: d.direct_gmv ?? 0,
        broad_gmv: d.broad_gmv ?? 0,
        expense: d.expense ?? 0,
        cost_per_conversion: d.cost_per_conversion ?? 0,
        direct_roas: d.direct_roas ?? 0,
        broad_roas: d.broad_roas ?? 0,
        synced_at: new Date().toISOString(),
      }))
      .filter(r => r.date != null);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('shopee_ads_daily')
        .upsert(rows, { onConflict: 'shop_id,date' });
      if (error) throw new Error(`UPSERT shopee_ads_daily: ${error.message}`);
    }

    // Upsert explícito — cria linha na primeira execução, atualiza nas subsequentes.
    const { error: ckErr } = await supabase.from('shopee_sync_checkpoint').upsert(
      {
        shop_id: shop.shop_id,
        job_name: JOB_NAME,
        last_window_from: new Date(fromSec * 1000).toISOString(),
        last_window_to: new Date(nowSec * 1000).toISOString(),
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_message: null,
        is_running: false,
      },
      { onConflict: 'shop_id,job_name' },
    );
    if (ckErr) console.error('[shopee-sync][ads] checkpoint upsert:', ckErr.message);

    console.log(`[shopee-sync][ads] shop_id=${shop.shop_id} days=${rows.length}`);
    return {
      job: JOB_NAME, shop_id: shop.shop_id, processed: rows.length,
      duration_ms: elapsed(), stopped_reason: 'complete' as StoppedReason, next_cursor: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][ads] shop_id=${shop.shop_id} ERRO:`, msg);
    await updateCheckpoint(shop.shop_id, JOB_NAME, {
      last_error_at: new Date().toISOString(),
      last_error_message: msg,
      is_running: false,
    });
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const shopIdParam = request.nextUrl.searchParams.get('shop_id');
  const shop = await resolveTargetShop(JOB_NAME, shopIdParam);
  if (!shop) {
    return NextResponse.json({
      job: JOB_NAME, shop_id: null, processed: 0, duration_ms: 0,
      stopped_reason: 'no_shops' as const, next_cursor: null,
    });
  }

  try {
    return NextResponse.json(await runOneShop(shop));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json(
      { job: JOB_NAME, shop_id: shop.shop_id, error: msg },
      { status: 502 },
    );
  }
}
