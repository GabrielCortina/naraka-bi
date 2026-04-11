import { NextResponse } from 'next/server';
import { isTinyConnected } from '@/lib/tiny-auth';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/status
// Retorna status da conexão Tiny e dados do polling
export async function GET() {
  try {
    const [tinyStatus, pollingData, pedidosInfo] = await Promise.all([
      isTinyConnected(),
      getPollingState(),
      getPedidosInfo(),
    ]);

    // Se status "running" há mais de 10 min, considera como finalizado
    if (pollingData?.status === 'running') {
      const updatedAt = new Date(pollingData.updated_at).getTime();
      const dezMinAtras = Date.now() - 10 * 60 * 1000;
      if (updatedAt < dezMinAtras) {
        pollingData.status = 'idle';
        // Atualiza no banco para destravar
        const supabase = createServiceClient();
        await supabase.from('polling_state').update({
          status: 'idle',
          updated_at: new Date().toISOString(),
        }).eq('id', 1);
      }
    }

    return NextResponse.json({
      tiny: tinyStatus,
      polling: pollingData,
      pedidos: pedidosInfo,
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

async function getPedidosInfo() {
  const supabase = createServiceClient();

  // Total de pedidos e última sincronização real (MAX de last_sync_at)
  const [countResult, syncResult] = await Promise.all([
    supabase.from('pedidos').select('*', { count: 'exact', head: true }),
    supabase.from('pedidos').select('last_sync_at').order('last_sync_at', { ascending: false }).limit(1).single(),
  ]);

  return {
    total: countResult.count || 0,
    ultimaSincronizacao: syncResult.data?.last_sync_at || null,
  };
}
