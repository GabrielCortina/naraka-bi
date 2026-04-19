import { NextRequest, NextResponse } from 'next/server';
import { shopeeApiCall } from '@/lib/shopee/client';
import { createServiceClient } from '@/lib/supabase-server';

// TEMPORÁRIO: rota de exploração dos endpoints Shopee. Remover após validar
// quais dados a API retorna no sandbox BR.
// Métodos/paths conferidos contra SHOPEE_API_REFERENCE.md §3.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DAY_SEC = 24 * 60 * 60;

// Shopee BR (/ads/*) exige DD-MM-YYYY. YYYY-MM-DD é rejeitado.
function fmtDMY(ts: number): string {
  const d = new Date(ts * 1000);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const y = d.getUTCFullYear();
  return `${day}-${m}-${y}`;
}

type TestName =
  | 'orders'
  | 'order_detail'
  | 'escrow'
  | 'wallet'
  | 'returns'
  | 'ads'
  | 'income'
  | 'shop_performance';

const VALID_TESTS: TestName[] = [
  'orders', 'order_detail', 'escrow', 'wallet',
  'returns', 'ads', 'income', 'shop_performance',
];

async function getAccessTokenForShop(shopId: number): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('shopee_tokens')
    .select('access_token, token_expires_at')
    .eq('shop_id', shopId)
    .single();

  if (!data) return null;
  if (new Date(data.token_expires_at).getTime() < Date.now()) return null;
  return data.access_token as string;
}

interface TestCall {
  path: string;
  method: 'GET' | 'POST';
  params: Record<string, unknown>;
}

interface OrdersOptions {
  days?: number;
  orderStatus?: string;
}

function buildCall(
  test: TestName,
  nowSec: number,
  orderSn: string | null,
  ordersOpts: OrdersOptions = {},
): TestCall | { error: string } {
  const sevenAgo = nowSec - 7 * DAY_SEC;
  // wallet e returns falham com "janela > 15 dias" — usar 14 dias por segurança.
  const fourteenAgo = nowSec - 14 * DAY_SEC;
  const thirtyAgo = nowSec - 30 * DAY_SEC;

  switch (test) {
    case 'orders': {
      const days = ordersOpts.days ?? 7;
      const timeFrom = nowSec - days * DAY_SEC;
      const params: Record<string, unknown> = {
        time_range_field: 'create_time',
        time_from: timeFrom,
        time_to: nowSec,
        page_size: 20,
      };
      if (ordersOpts.orderStatus) params.order_status = ordersOpts.orderStatus;
      return {
        path: '/api/v2/order/get_order_list',
        method: 'GET',
        params,
      };
    }

    case 'order_detail':
      if (!orderSn) return { error: 'query param order_sn é obrigatório para test=order_detail' };
      // get_order_detail é GET (metadata: method:2). order_sn_list e response_optional_fields
      // são strings CSV na query string — NÃO arrays JSON no body.
      // Ref: shopee-payment-docs.md §8 + _metadata.json.
      return {
        path: '/api/v2/order/get_order_detail',
        method: 'GET',
        params: {
          order_sn_list: orderSn,
          response_optional_fields: [
            'buyer_user_id', 'buyer_username', 'estimated_shipping_fee',
            'recipient_address', 'actual_shipping_fee', 'goods_to_declare',
            'note', 'note_update_time', 'item_list', 'pay_time',
            'dropshipper', 'dropshipper_phone', 'split_up',
            'buyer_cancel_reason', 'cancel_by', 'cancel_reason',
            'actual_shipping_fee_confirmed', 'buyer_cpf_id',
            'fulfillment_flag', 'pickup_done_time', 'package_list',
            'shipping_carrier', 'payment_method', 'total_amount',
            'invoice_data', 'checkout_shipping_carrier', 'reverse_shipping_fee',
            'order_chargeable_weight_gram', 'edt',
            'prescription_images', 'prescription_check_status',
          ].join(','),
        },
      };

    case 'escrow':
      if (!orderSn) return { error: 'query param order_sn é obrigatório para test=escrow' };
      return {
        path: '/api/v2/payment/get_escrow_detail',
        method: 'GET',
        params: { order_sn: orderSn },
      };

    case 'wallet':
      return {
        path: '/api/v2/payment/get_wallet_transaction_list',
        method: 'GET',
        params: {
          page_no: 1,
          page_size: 20,
          create_time_from: fourteenAgo,
          create_time_to: nowSec,
        },
      };

    case 'returns':
      return {
        path: '/api/v2/returns/get_return_list',
        method: 'GET',
        params: {
          page_no: 1,
          page_size: 20,
          create_time_from: fourteenAgo,
          create_time_to: nowSec,
        },
      };

    case 'ads':
      // Shopee BR exige DD-MM-YYYY (confirmado empiricamente no sandbox).
      return {
        path: '/api/v2/ads/get_all_cpc_ads_daily_performance',
        method: 'GET',
        params: {
          start_date: fmtDMY(sevenAgo),
          end_date: fmtDMY(nowSec),
        },
      };

    case 'income':
      // Ref doc marca GET para get_escrow_list (§3.2). Usando GET.
      return {
        path: '/api/v2/payment/get_escrow_list',
        method: 'GET',
        params: {
          release_time_from: thirtyAgo,
          release_time_to: nowSec,
          page_size: 20,
          page_no: 1,
        },
      };

    case 'shop_performance':
      return {
        path: '/api/v2/account_health/shop_performance',
        method: 'GET',
        params: {},
      };
  }
}

// GET /api/shopee/explore?shop_id=<n>&test=<name>[&order_sn=<sn>][&status=<enum>][&days=<n>]
// status/days só têm efeito em test=orders (filtram get_order_list).
export async function GET(request: NextRequest) {
  const shopIdRaw = request.nextUrl.searchParams.get('shop_id');
  const test = request.nextUrl.searchParams.get('test') as TestName | null;
  const orderSn = request.nextUrl.searchParams.get('order_sn');
  const status = request.nextUrl.searchParams.get('status');
  const daysRaw = request.nextUrl.searchParams.get('days');

  if (!shopIdRaw) {
    return NextResponse.json({ error: 'query param shop_id é obrigatório' }, { status: 400 });
  }
  const shopId = Number(shopIdRaw);
  if (!Number.isFinite(shopId)) {
    return NextResponse.json({ error: 'shop_id inválido' }, { status: 400 });
  }
  if (!test || !VALID_TESTS.includes(test)) {
    return NextResponse.json(
      { error: `query param test inválido. Valores: ${VALID_TESTS.join(', ')}` },
      { status: 400 },
    );
  }
  let days: number | undefined;
  if (daysRaw != null) {
    const parsed = Number(daysRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return NextResponse.json({ error: 'days deve ser inteiro positivo' }, { status: 400 });
    }
    days = parsed;
  }

  const accessToken = await getAccessTokenForShop(shopId);
  if (!accessToken) {
    return NextResponse.json(
      { error: 'Tokens não encontrados ou access_token expirado (faça refresh)' },
      { status: 404 },
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const call = buildCall(test, nowSec, orderSn, { days, orderStatus: status ?? undefined });
  if ('error' in call) {
    return NextResponse.json({ error: call.error }, { status: 400 });
  }

  console.log(`[shopee-explore] test=${test} shop_id=${shopId} ${call.method} ${call.path}`, {
    params: call.params,
  });

  try {
    const response = await shopeeApiCall(
      call.path,
      call.params,
      shopId,
      accessToken,
      call.method,
    );

    console.log(`[shopee-explore] test=${test} OK`);
    return NextResponse.json({
      test,
      endpoint: call.path,
      method: call.method,
      params: call.params,
      response,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error(`[shopee-explore] test=${test} FAIL:`, message);
    return NextResponse.json(
      {
        test,
        endpoint: call.path,
        method: call.method,
        params: call.params,
        error: message,
      },
      { status: 502 },
    );
  }
}
