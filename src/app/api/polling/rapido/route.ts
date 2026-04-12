import { NextRequest, NextResponse } from 'next/server';
import { pollingRapido } from '@/lib/polling-service';
import { iniciarLog, finalizarLogSucesso, finalizarLogErro } from '@/lib/polling-logger';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  const { logId, startTime } = await iniciarLog('rapido');

  try {
    const resultado = await pollingRapido();
    await finalizarLogSucesso(logId, startTime, resultado);
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    await finalizarLogErro(logId, startTime, mensagem);
    return NextResponse.json({ success: false, camada: 'rapido', erro: mensagem }, { status: 500 });
  }
}
