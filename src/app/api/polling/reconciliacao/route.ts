import { NextRequest, NextResponse } from 'next/server';
import { pollingReconciliacao } from '@/lib/polling-service';
import { iniciarLog, finalizarLogSucesso, finalizarLogErro } from '@/lib/polling-logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret && process.env.NODE_ENV === 'production') {
    console.error('[reconciliacao] CRON_SECRET não configurado em produção');
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 });
  }

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { logId, startTime } = await iniciarLog('reconciliacao');

  try {
    const resultado = await pollingReconciliacao();
    await finalizarLogSucesso(logId, startTime, resultado);
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    await finalizarLogErro(logId, startTime, mensagem);
    return NextResponse.json({ success: false, camada: 'reconciliacao', erro: mensagem }, { status: 500 });
  }
}
