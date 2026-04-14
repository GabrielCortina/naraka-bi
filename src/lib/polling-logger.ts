import { createServiceClient } from './supabase-server';
import type { PollingResult } from './polling-service';

type Camada = 'rapido' | 'status' | 'reconciliacao' | 'webhook' | 'retry' | 'sweep';

// Inicia um log de execução e retorna o id + startTime
export async function iniciarLog(camada: Camada): Promise<{ logId: number; startTime: number }> {
  const supabase = createServiceClient();
  const startTime = Date.now();

  const { data } = await supabase
    .from('polling_logs')
    .insert({ camada, iniciado_em: new Date().toISOString(), status: 'running' })
    .select('id')
    .single();

  return { logId: data?.id ?? 0, startTime };
}

// Finaliza o log com sucesso
export async function finalizarLogSucesso(
  logId: number,
  startTime: number,
  resultado: PollingResult,
) {
  if (!logId) return;
  const supabase = createServiceClient();

  await supabase.from('polling_logs').update({
    status: 'success',
    finalizado_em: new Date().toISOString(),
    duracao_ms: Date.now() - startTime,
    pedidos_processados: resultado.pedidosProcessados,
  }).eq('id', logId);
}

// Finaliza o log com erro
export async function finalizarLogErro(logId: number, startTime: number, erro: string) {
  if (!logId) return;
  const supabase = createServiceClient();

  await supabase.from('polling_logs').update({
    status: 'error',
    finalizado_em: new Date().toISOString(),
    duracao_ms: Date.now() - startTime,
    erro_mensagem: erro,
  }).eq('id', logId);
}
