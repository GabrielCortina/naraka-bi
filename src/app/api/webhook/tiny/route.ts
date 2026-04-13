import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { obterPedido } from '@/lib/tiny-api';
import { upsertPedido } from '@/lib/polling-service';
import type { TinyPedidoFull } from '@/types/tiny';

// POST /api/webhook/tiny
// Recebe notificações da Tiny (inclusao_pedido, atualizacao_pedido).
// Processa DIRETO com retry. Se falhar, insere na fila de retry.
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

// Retry com backoff exponencial: 2s, 4s, 8s
async function obterPedidoComRetry(idPedido: number, maxTentativas = 3): Promise<TinyPedidoFull> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const { data: pedidoCompleto } = await obterPedido(idPedido);
      return pedidoCompleto;
    } catch (err) {
      ultimoErro = err instanceof Error ? err : new Error(String(err));
      console.warn(`[webhook] Tentativa ${tentativa}/${maxTentativas} falhou para pedido ${idPedido}: ${ultimoErro.message}`);
      if (tentativa < maxTentativas) {
        const delay = Math.pow(2, tentativa) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw ultimoErro;
}

async function processarWebhook(body: Record<string, unknown>, startTime: number) {
  const supabase = createServiceClient();
  const tipo = body.tipo as string | undefined;
  const dados = body.dados as Record<string, unknown> | undefined;
  const idPedido = dados?.id ? Number(dados.id) : null;

  if (!tipo || !idPedido || (tipo !== 'inclusao_pedido' && tipo !== 'atualizacao_pedido')) {
    console.log(`[webhook] Tipo ignorado: ${tipo}`);
    await logWebhook(supabase, startTime, 'success', null, 0, { tipo, ignorado: true });
    return;
  }

  try {
    // Tenta processar direto com retry (2s, 4s entre tentativas)
    const pedidoCompleto = await obterPedidoComRetry(idPedido, 3);
    await upsertPedido(pedidoCompleto);
    console.log(`[webhook] Pedido ${idPedido} processado diretamente (${tipo})`);
    await logWebhook(supabase, startTime, 'success', null, 1, { tipo, id: idPedido });

  } catch (err) {
    // Só vai para fila se FALHOU após todas as tentativas
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error(`[webhook] Falhou após 3 tentativas para pedido ${idPedido}. Enfileirando para retry.`);

    // Verifica duplicata antes de inserir
    const { data: existente } = await supabase
      .from('webhook_retry_queue')
      .select('id')
      .eq('id_pedido', idPedido)
      .eq('processado', false)
      .limit(1)
      .maybeSingle();

    if (!existente) {
      try {
        await supabase.from('webhook_retry_queue').insert({
          id_pedido: idPedido,
          tipo,
          tentativas: 3,
          ultimo_erro: msg,
          proxima_tentativa: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          processado: false,
        });
      } catch (queueErr) {
        console.error('[webhook] Falha ao inserir na fila de retry:', queueErr);
      }
    }

    await logWebhook(supabase, startTime, 'error', msg, 0, {
      tipo, id: idPedido, na_fila_retry: true,
    });
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
