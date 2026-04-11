import { NextRequest, NextResponse } from 'next/server';
import { pollingRapido } from '@/lib/polling-service';

// GET /api/polling/rapido — Camada 1: a cada 5 min
// Busca pedidos atualizados hoje e ontem
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  try {
    const resultado = await pollingRapido();
    return NextResponse.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    return NextResponse.json({ success: false, camada: 'rapido', erro: mensagem }, { status: 500 });
  }
}
