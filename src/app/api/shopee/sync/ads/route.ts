import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import {
  getActiveShops,
  shopeeCallWithRefresh,
  sleep,
  fmtDMY,
  type ActiveShop,
} from '@/lib/shopee/sync-helpers';

// Sync de Shopee Ads daily. Janela fixa últimos 7 dias (rotina diária).
// ⚠️ BR exige formato DD-MM-YYYY em start_date/end_date — YYYY-MM-DD é rejeitado.
// Ref: SHOPEE_API_REFERENCE.md §3.7.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

const JOB_NAME = 'sync_ads';
const THROTTLE_MS = 500;
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
interface AdsResp {
  shop_performance?: { daily_performance?: DailyPerformance[] };
  daily_performance?: DailyPerformance[];
}

interface ShopResult {
  shop_id: number;
  days?: number;
  error?: string;
}

// Shopee retorna date em DD-MM-YYYY nos BR. Normaliza para YYYY-MM-DD (DATE do PG).
function normalizeDate(d: string | undefined): string | null {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const m = d.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

async function syncOneShop(shop: ActiveShop): Promise<ShopResult> {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = nowSec - LOOKBACK_DAYS * 86400;

    const resp = await shopeeCallWithRefresh<AdsResp>(
      shop,
      '/api/v2/ads/get_all_cpc_ads_daily_performance',
      { start_date: fmtDMY(fromSec), end_date: fmtDMY(nowSec) },
    );
    await sleep(THROTTLE_MS);

    // A resposta pode vir em response.shop_performance.daily_performance ou response.daily_performance
    const daily =
      resp.response?.shop_performance?.daily_performance ??
      resp.response?.daily_performance ??
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

    console.log(`[shopee-sync][ads] shop_id=${shop.shop_id} days=${rows.length}`);
    return { shop_id: shop.shop_id, days: rows.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-sync][ads] shop_id=${shop.shop_id} ERRO:`, msg);
    return { shop_id: shop.shop_id, error: msg };
  }
}

export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const all = await getActiveShops();
  const target = shopIdRaw ? all.filter(s => s.shop_id === Number(shopIdRaw)) : all;
  if (target.length === 0) return NextResponse.json({ error: 'Nenhuma loja ativa' }, { status: 404 });

  const results: ShopResult[] = [];
  for (const shop of target) results.push(await syncOneShop(shop));

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: results.length,
    days_synced: results.reduce((s, r) => s + (r.days ?? 0), 0),
    errors: results.filter(r => r.error).length,
    results,
  });
}
