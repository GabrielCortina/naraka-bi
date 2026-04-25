import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/shopee/auth';
import { getShopeeConfigByLabel } from '@/lib/shopee/config';

// Sign da Shopee é HMAC(partner_id + path + timestamp). Timestamp tem janela
// de 5 min — qualquer cache do Next/Vercel faz a URL estourar com "Invalid timestamp".
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/auth/shopee
// Inicia o fluxo OAuth da Shopee. Redireciona o browser para a página de
// autorização do Partner portal. Após o seller autorizar, Shopee redireciona
// de volta para o callback com ?code=&shop_id=&partner_id=.
//
// Multi-app (migration 057_shopee_apps):
//   ?partner_id=2033526  — escolhe app pelo partner_id em shopee_apps
//   ?app=joy             — escolhe app pelo label (case-insensitive)
//   sem param            — usa env vars (Oxean default)
export async function GET(request: NextRequest) {
  try {
    const partnerIdParam = request.nextUrl.searchParams.get('partner_id');
    const appLabel = request.nextUrl.searchParams.get('app');

    let partnerId: number | undefined;
    if (partnerIdParam) {
      const id = Number(partnerIdParam);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ error: 'partner_id inválido' }, { status: 400 });
      }
      partnerId = id;
    } else if (appLabel) {
      const cfg = await getShopeeConfigByLabel(appLabel);
      partnerId = Number(cfg.partnerId);
    }

    const url = await getAuthUrl(partnerId);
    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[shopee-connect] Erro:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
