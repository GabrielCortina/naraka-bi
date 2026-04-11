import { NextRequest, NextResponse } from 'next/server';
import { pollingReconciliacao } from '@/lib/polling-service';

// GET /api/polling/reconciliacao — Camada 3: 1x por dia às 03:00
// Reconcilia pedidos dos últimos 3 dias
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await pollingReconciliacao();
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, camada: 'reconciliacao', erro: mensagem }, { status: 500 });
  }
}
