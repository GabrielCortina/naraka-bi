import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

const SITUACOES_FINAIS = [1, 2, 5, 6, 9];

// POST /api/webhook/tiny
// Recebe notificações de mudança de status da Tiny em tempo real.
// SEMPRE retorna 200 — a Tiny para de reenviar se receber erro.
export async function POST(request: NextRequest) {
  // Retorna 200 imediatamente e processa em background
  const response = NextResponse.json({ status: 'ok' });

  try {
    const payload = await request.json();
    processarWebhook(payload).catch(err =>
      console.error('[webhook] Erro no processamento:', err)
    );
  } catch {
    console.error('[webhook] Payload inválido');
  }

  return response;
}

async function processarWebhook(payload: { tipo?: string; dados?: { id?: number; situacao?: number } }) {
  const supabase = createServiceClient();

  const tipo = payload?.tipo;
  const idPedido = payload?.dados?.id;
  const novaSituacao = payload?.dados?.situacao;

  if (!tipo || !idPedido || novaSituacao === undefined) {
    console.error('[webhook] Payload incompleto:', JSON.stringify(payload));
    await logWebhook(supabase, 'error', 'Payload incompleto', payload);
    return;
  }

  try {
    const situacaoFinal = SITUACOES_FINAIS.includes(novaSituacao);

    const { error } = await supabase
      .from('pedidos')
      .update({
        situacao: novaSituacao,
        situacao_final: situacaoFinal,
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', idPedido);

    if (error) {
      console.error(`[webhook] Erro ao atualizar pedido ${idPedido}:`, error);
      await logWebhook(supabase, 'error', error.message, { tipo, id: idPedido, situacao: novaSituacao });
      return;
    }

    console.log(`[webhook] Pedido ${idPedido} → situação ${novaSituacao} (final: ${situacaoFinal})`);
    await logWebhook(supabase, 'success', null, { tipo, id: idPedido, situacao: novaSituacao });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error(`[webhook] Erro fatal:`, msg);
    await logWebhook(supabase, 'error', msg, { tipo, id: idPedido, situacao: novaSituacao });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logWebhook(supabase: any, status: string, erro: string | null, detalhes: Record<string, unknown>) {
  try {
    const agora = new Date().toISOString();
    await supabase.from('polling_logs').insert({
      camada: 'webhook',
      iniciado_em: agora,
      finalizado_em: agora,
      duracao_ms: 0,
      pedidos_processados: status === 'success' ? 1 : 0,
      pedidos_erro: status === 'error' ? 1 : 0,
      status,
      erro_mensagem: erro,
      detalhes,
    });
  } catch {
    console.error('[webhook] Falha ao salvar log');
  }
}
