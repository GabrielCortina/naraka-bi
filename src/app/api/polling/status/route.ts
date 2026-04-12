import { NextRequest, NextResponse } from 'next/server';
import { pollingStatus } from '@/lib/polling-service';
import { iniciarLog, finalizarLogSucesso, finalizarLogErro } from '@/lib/polling-logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { logId, startTime } = await iniciarLog('status');

  try {
    const resultado = await pollingStatus();
    await finalizarLogSucesso(logId, startTime, resultado);
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    await finalizarLogErro(logId, startTime, mensagem);
    return NextResponse.json({ success: false, camada: 'status', erro: mensagem }, { status: 500 });
  }
}
