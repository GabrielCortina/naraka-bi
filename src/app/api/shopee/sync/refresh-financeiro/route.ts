import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getActiveShops, type ActiveShop } from '@/lib/shopee/sync-helpers';
import { startAudit, finishAudit } from '@/lib/shopee/audit';

// Refresh do summary diário do dashboard financeiro Shopee.
// Re-executa refresh_shopee_financeiro_daily(data, shop_id) para cada
// loja ativa nos últimos 2–3 dias BRT (hoje + ontem, e anteontem se sobrar
// tempo). Hoje capta movimentação do dia; ontem cobre escrows liberados
// com atraso / wallet que chegou depois; anteontem é rede de segurança.
//
// A função SQL é a única fonte da verdade dos KPIs — este handler apenas
// dispara. Quando a API do financeiro migrar para ler do summary, os KPIs
// já estarão atualizados no máximo em 10min.

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 55;

const JOB_NAME = 'refresh_financeiro';
const MAX_ELAPSED_MS = 45 * 1000;
const BR_OFFSET_MS = 3 * 3600 * 1000;

// Extrai YYYY-MM-DD da data BRT de um instante UTC.
function brDateString(d: Date): string {
  const shifted = new Date(d.getTime() - BR_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Aritmética de data por string (YYYY-MM-DD ± dias).
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

interface DayResult {
  date: string;
  shop_id: number;
  status: 'ok' | 'error';
  error?: string;
}

async function refreshOneShop(
  shop: ActiveShop,
  dates: string[],
  timeLeft: () => number,
): Promise<{ results: DayResult[]; status: 'success' | 'partial' | 'error'; errorMsg?: string }> {
  const supabase = createServiceClient();
  const shopStart = Date.now();
  const results: DayResult[] = [];

  const auditId = await startAudit({
    shop_id: shop.shop_id,
    job_name: JOB_NAME,
    window_from: `${dates[dates.length - 1]}T03:00:00Z`,
    window_to: `${addDays(dates[0], 1)}T03:00:00Z`,
  });

  let anyError = false;
  let stopped = false;

  for (const date of dates) {
    if (timeLeft() < 3000) {
      stopped = true;
      break;
    }
    const { error } = await supabase.rpc('refresh_shopee_financeiro_daily', {
      p_data: date,
      p_shop_id: shop.shop_id,
    });
    if (error) {
      anyError = true;
      results.push({ date, shop_id: shop.shop_id, status: 'error', error: error.message });
      console.error(
        `[shopee-sync][refresh-financeiro] shop_id=${shop.shop_id} date=${date} ERRO:`,
        error.message,
      );
    } else {
      results.push({ date, shop_id: shop.shop_id, status: 'ok' });
    }
  }

  const status: 'success' | 'partial' | 'error' =
    stopped ? 'partial'
    : anyError && results.every(r => r.status === 'error') ? 'error'
    : anyError ? 'partial'
    : 'success';

  const okCount = results.filter(r => r.status === 'ok').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const firstError = results.find(r => r.status === 'error')?.error;

  await finishAudit(
    auditId,
    status,
    {
      rows_updated: okCount,
      errors_count: errorCount,
      error_message: firstError,
      metadata: { dates_processed: results.map(r => ({ date: r.date, status: r.status })) },
    },
    shopStart,
  );

  console.log(
    `[shopee-sync][refresh-financeiro] shop_id=${shop.shop_id} status=${status} days_ok=${okCount} days_err=${errorCount}`,
  );

  return { results, status, errorMsg: firstError };
}

export async function GET() {
  const startedAt = Date.now();
  const timeLeft = () => MAX_ELAPSED_MS - (Date.now() - startedAt);

  const shops = await getActiveShops();
  if (shops.length === 0) {
    return NextResponse.json({
      job: JOB_NAME,
      shops_processed: 0,
      days_refreshed: [],
      duration_ms: Date.now() - startedAt,
    });
  }

  const now = new Date();
  const today = brDateString(now);
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);

  // Hoje e ontem sempre rodam; anteontem só se houver folga de 15s em relação
  // ao budget de 45s (3 dias × N lojas em sequência pode estourar).
  const includeDayBefore = () => timeLeft() > 15_000;

  const allResults: DayResult[] = [];
  const shopsPending: number[] = [];
  let shopsOk = 0;

  for (const shop of shops) {
    if (timeLeft() < 5000) {
      shopsPending.push(shop.shop_id);
      continue;
    }
    const dates = [today, yesterday];
    if (includeDayBefore()) dates.push(dayBefore);

    const { results } = await refreshOneShop(shop, dates, timeLeft);
    allResults.push(...results);
    shopsOk++;
  }

  if (shopsPending.length > 0) {
    console.warn(
      `[shopee-sync][refresh-financeiro] tempo esgotado, lojas pendentes: ${shopsPending.join(',')}`,
    );
  }

  return NextResponse.json({
    job: JOB_NAME,
    shops_processed: shopsOk,
    shops_pending: shopsPending,
    days_refreshed: allResults,
    duration_ms: Date.now() - startedAt,
  });
}
