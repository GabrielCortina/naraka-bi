import { NextResponse } from 'next/server';
import { isTinyConnected } from '@/lib/tiny-auth';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/status
// Retorna status da conexão Tiny e dados do polling
export async function GET() {
  try {
    const [tinyStatus, pollingData, pedidosCount] = await Promise.all([
      isTinyConnected(),
      getPollingState(),
      getTotalPedidos(),
    ]);

    return NextResponse.json({
      tiny: tinyStatus,
      polling: pollingData,
      pedidos: { total: pedidosCount },
    });
  } catch (err) {
    console.error('[api/status] Erro:', err);
    return NextResponse.json(
      { error: 'Erro ao buscar status' },
      { status: 500 }
    );
  }
}

async function getPollingState() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('polling_state')
    .select('*')
    .eq('id', 1)
    .single();

  return data;
}

async function getTotalPedidos() {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from('pedidos')
    .select('*', { count: 'exact', head: true });

  return count || 0;
}
