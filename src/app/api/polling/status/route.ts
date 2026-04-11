import { NextRequest, NextResponse } from 'next/server';
import { pollingStatus } from '@/lib/polling-service';

// GET /api/polling/status — Camada 2: a cada 10 min
// Atualiza pedidos "vivos" (situacao_final=false, last_sync_at > 10 min)
// Máximo 50 pedidos por execução
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await pollingStatus();
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, camada: 'status', erro: mensagem }, { status: 500 });
  }
}
