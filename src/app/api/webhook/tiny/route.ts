import { NextResponse } from 'next/server';

// POST /api/webhook/tiny
// Endpoint preparado para receber webhooks da Tiny no futuro.
// Será ativado após deploy no Vercel com URL pública.
// Por enquanto retorna 200 indicando que o endpoint existe mas não está ativo.
export async function POST() {
  return NextResponse.json({
    status: 'ok',
    message: 'Webhook endpoint preparado. Será ativado após configuração no Tiny ERP.',
  });
}
