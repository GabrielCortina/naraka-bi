import { NextRequest, NextResponse } from 'next/server';
import { executarPolling } from '@/lib/polling-service';

// GET /api/polling
// Executa um ciclo de polling de pedidos da Tiny
// Chamado pelo Vercel Cron Jobs (GET) — protegido por CRON_SECRET
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await executarPolling();
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[api/polling] Erro:', mensagem);
    return NextResponse.json(
      { success: false, erro: mensagem },
      { status: 500 }
    );
  }
}
