import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// POST /api/webhook/tiny
// Recebe notificações da Tiny (inclusao_pedido, atualizacao_pedido).
// Apenas insere na fila de retry — o Polling Rápido processa com rate limit.
// SEMPRE retorna 200.
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let body: Record<string, unknown> | null = null;

  try {
    body = await request.json();
  } catch {
    console.error('[webhook] Body não é JSON válido');
  }

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

  if (!tipo || !idPedido || (tipo !== 'inclusao_pedido' && tipo !== 'atualizacao_pedido')) {
    await logWebhook(supabase, startTime, 'success', null, 0, { tipo, ignorado: true });
    return;
  }

  try {
    // Verifica se já existe item não processado para este pedido
    const { data: existente } = await supabase
      .from('webhook_retry_queue')
      .select('id')
      .eq('id_pedido', idPedido)
      .eq('processado', false)
      .limit(1)
      .maybeSingle();

    if (existente) {
      console.log(`[webhook] Pedido ${idPedido} já está na fila (${tipo}), ignorando duplicata`);
      await logWebhook(supabase, startTime, 'success', null, 0, { tipo, id: idPedido, duplicata: true });
      return;
    }

    // Insere na fila para o Polling Rápido processar com rate limit
    await supabase.from('webhook_retry_queue').insert({
      id_pedido: idPedido,
      tipo,
      tentativas: 0,
      ultimo_erro: null,
      proxima_tentativa: new Date().toISOString(),
      processado: false,
    });

    console.log(`[webhook] Pedido ${idPedido} enfileirado (${tipo})`);
    await logWebhook(supabase, startTime, 'success', null, 0, { tipo, id: idPedido, enfileirado: true });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error(`[webhook] Erro ao enfileirar pedido ${idPedido}:`, msg);
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
