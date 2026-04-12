import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { obterPedido } from '@/lib/tiny-api';
import { upsertPedido } from '@/lib/polling-service';

// POST /api/webhook/tiny
// Recebe notificações da Tiny (inclusao_pedido, atualizacao_pedido).
// Busca o pedido completo na API e faz upsert no banco.
// SEMPRE retorna 200 — a Tiny para de reenviar se receber erro.
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: Record<string, unknown> | null = null;

  try {
    body = await request.json();
  } catch {
    console.error('[webhook] Body não é JSON válido');
  }

  console.log('[webhook] Payload recebido:', JSON.stringify(body));

  // Processa em background — retorna 200 imediatamente
  if (body) {
    processarWebhook(body, startTime).catch(err =>
      console.error('[webhook] Erro no processamento:', err)
    );
  }

  return NextResponse.json({ status: 'ok' });
}

async function processarWebhook(body: Record<string, unknown>, startTime: number) {
  const supabase = createServiceClient();
  const tipo = body.tipo as string | undefined;
  const dados = body.dados as Record<string, unknown> | undefined;
  const idPedido = dados?.id ? Number(dados.id) : null;

  // Só processa inclusão ou atualização de pedido
  if (!tipo || !idPedido || (tipo !== 'inclusao_pedido' && tipo !== 'atualizacao_pedido')) {
    console.log(`[webhook] Tipo ignorado: ${tipo}`);
    await logWebhook(supabase, startTime, 'success', null, 0, { tipo, ignorado: true });
    return;
  }

  try {
    // Busca pedido completo na Tiny API
    const { data: pedidoCompleto } = await obterPedido(idPedido);

    // Upsert completo (igual ao polling rápido)
    await upsertPedido(pedidoCompleto);

    console.log(`[webhook] Pedido ${idPedido} processado (${tipo})`);
    await logWebhook(supabase, startTime, 'success', null, 1, { tipo, id: idPedido });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error(`[webhook] Erro ao processar pedido ${idPedido}:`, msg);
    await logWebhook(supabase, startTime, 'error', msg, 0, { tipo, id: idPedido });
  }
}

async function logWebhook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  startTime: number,
  status: string,
  erro: string | null,
  processados: number,
  detalhes: Record<string, unknown>,
) {
  try {
    const agora = new Date().toISOString();
    await supabase.from('polling_logs').insert({
      camada: 'webhook',
      iniciado_em: new Date(startTime).toISOString(),
      finalizado_em: agora,
      duracao_ms: Date.now() - startTime,
      pedidos_processados: processados,
      pedidos_erro: status === 'error' ? 1 : 0,
      status,
      erro_mensagem: erro,
      detalhes,
    });
  } catch {
    console.error('[webhook] Falha ao salvar log');
  }
}
