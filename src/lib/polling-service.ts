import { createServiceClient } from './supabase-server';
import { listarPedidos, obterPedido, waitForRateLimit } from './tiny-api';
import type { TinyPedidoFull } from '@/types/tiny';
import type { RateLimitInfo } from './tiny-api';

// Situações realmente finais — pedido não muda mais
const SITUACOES_FINAIS = [2, 6, 9]; // Cancelado, Devolvido, Entregue

export interface PollingResult {
  success: boolean;
  pedidosProcessados: number;
  camada: string;
  erro?: string;
}

// Converte strings vazias para null (a Tiny retorna "" em campos opcionais)
function emptyToNull<T>(value: T): T | null {
  if (value === '' || value === undefined || value === null) return null;
  return value;
}

// Retorna data no formato yyyy-MM-dd, N dias atrás
function dataDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().split('T')[0];
}

// ============================================================
// POLLING STATE: leitura e atualização
// ============================================================
async function getPollingState() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('polling_state')
    .select('*')
    .eq('id', 1)
    .single();
  return data;
}

async function updatePollingState(updates: Record<string, unknown>) {
  const supabase = createServiceClient();
  await supabase.from('polling_state').upsert({
    id: 1,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

// ============================================================
// CORE: Salva/atualiza um pedido completo no banco
// Reutilizado por todas as camadas
// ============================================================
export async function upsertPedido(pedido: TinyPedidoFull) {
  const supabase = createServiceClient();
  const agora = new Date().toISOString();
  const situacaoFinal = SITUACOES_FINAIS.includes(pedido.situacao);

  const { error: pedidoError } = await supabase.from('pedidos').upsert({
    id: pedido.id,
    numero_pedido: pedido.numeroPedido,
    id_nota_fiscal: emptyToNull(pedido.idNotaFiscal),
    data_faturamento: emptyToNull(pedido.dataFaturamento),
    valor_total_produtos: pedido.valorTotalProdutos ?? 0,
    valor_total_pedido: pedido.valorTotalPedido ?? 0,
    valor_desconto: pedido.valorDesconto ?? 0,
    valor_frete: pedido.valorFrete ?? 0,
    valor_outras_despesas: pedido.valorOutrasDespesas ?? 0,
    situacao: pedido.situacao ?? 0,
    situacao_final: situacaoFinal,
    data_pedido: emptyToNull(pedido.data) || new Date().toISOString().split('T')[0],
    data_entrega: emptyToNull(pedido.dataEntrega),
    data_prevista: emptyToNull(pedido.dataPrevista),
    data_envio: emptyToNull(pedido.dataEnvio),
    observacoes: emptyToNull(pedido.observacoes),
    observacoes_internas: emptyToNull(pedido.observacoesInternas),
    numero_ordem_compra: emptyToNull(pedido.numeroOrdemCompra),
    origem_pedido: pedido.origemPedido ?? 0,
    cliente_id: pedido.cliente?.id ?? null,
    cliente_nome: emptyToNull(pedido.cliente?.nome),
    cliente_cpf_cnpj: emptyToNull(pedido.cliente?.cpfCnpj),
    cliente_email: emptyToNull(pedido.cliente?.email),
    ecommerce_id: pedido.ecommerce?.id ?? null,
    ecommerce_nome: emptyToNull(pedido.ecommerce?.nome),
    numero_pedido_ecommerce: emptyToNull(pedido.ecommerce?.numeroPedidoEcommerce),
    canal_venda: emptyToNull(pedido.ecommerce?.canalVenda),
    transportador_id: pedido.transportador?.id ?? null,
    transportador_nome: emptyToNull(pedido.transportador?.nome),
    codigo_rastreamento: emptyToNull(pedido.transportador?.codigoRastreamento),
    vendedor_id: pedido.vendedor?.id ?? null,
    vendedor_nome: emptyToNull(pedido.vendedor?.nome),
    forma_pagamento: emptyToNull(pedido.pagamento?.formaRecebimento),
    meio_pagamento: emptyToNull(pedido.pagamento?.meioPagamento),
    raw_data: pedido as unknown as Record<string, unknown>,
    last_sync_at: agora,
    updated_at: agora,
  });

  if (pedidoError) {
    console.error(`[polling] Erro ao salvar pedido ${pedido.id}:`, pedidoError);
    throw pedidoError;
  }

  // Replace completo dos itens
  if (pedido.itens && pedido.itens.length > 0) {
    await supabase.from('pedido_itens').delete().eq('pedido_id', pedido.id);

    const itens = pedido.itens.map(item => ({
      pedido_id: pedido.id,
      produto_id: item.produto?.id ?? 0,
      sku: item.produto?.sku || 'SEM-SKU',
      descricao: item.produto?.descricao || 'Sem descrição',
      tipo_produto: item.produto?.tipo || 'P',
      quantidade: item.quantidade ?? 0,
      valor_unitario: item.valorUnitario ?? 0,
      valor_total: (item.quantidade ?? 0) * (item.valorUnitario ?? 0),
      info_adicional: emptyToNull(item.infoAdicional),
    }));

    const { error: itensError } = await supabase.from('pedido_itens').insert(itens);
    if (itensError) {
      console.error(`[polling] Erro ao salvar itens do pedido ${pedido.id}:`, itensError);
    }
  }
}

// ============================================================
// FILA DE RETRY: processa pedidos que falharam no webhook
// ============================================================
const MAX_TENTATIVAS_TOTAL = 5;

async function processarFilaRetry(): Promise<number> {
  const supabase = createServiceClient();
  let processados = 0;

  const { data: filaItems } = await supabase
    .from('webhook_retry_queue')
    .select('*')
    .eq('processado', false)
    .lte('proxima_tentativa', new Date().toISOString())
    .order('proxima_tentativa', { ascending: true })
    .limit(20);

  if (!filaItems || filaItems.length === 0) return 0;

  console.log(`[rapido] ${filaItems.length} itens na fila de retry`);

  for (const item of filaItems) {
    try {
      const { data: pedidoCompleto } = await obterPedido(item.id_pedido);
      await upsertPedido(pedidoCompleto);

      await supabase.from('webhook_retry_queue')
        .update({ processado: true, ultimo_erro: null })
        .eq('id', item.id);

      console.log(`[rapido] Retry sucesso: pedido ${item.id_pedido}`);
      processados++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro desconhecido';
      const novasTentativas = (item.tentativas || 0) + 1;

      if (novasTentativas >= MAX_TENTATIVAS_TOTAL) {
        await supabase.from('webhook_retry_queue')
          .update({
            processado: true,
            tentativas: novasTentativas,
            ultimo_erro: `Desistido após ${MAX_TENTATIVAS_TOTAL} tentativas: ${msg}`,
          })
          .eq('id', item.id);
        console.error(`[rapido] Retry desistido após ${MAX_TENTATIVAS_TOTAL} tentativas: pedido ${item.id_pedido}`);
      } else {
        const proximaTentativa = new Date(Date.now() + novasTentativas * 5 * 60 * 1000).toISOString();
        await supabase.from('webhook_retry_queue')
          .update({
            tentativas: novasTentativas,
            ultimo_erro: msg,
            proxima_tentativa: proximaTentativa,
          })
          .eq('id', item.id);
        console.warn(`[rapido] Retry falhou (${novasTentativas}/${MAX_TENTATIVAS_TOTAL}): pedido ${item.id_pedido}. Próxima: ${proximaTentativa}`);
      }
    }
  }

  return processados;
}

// ============================================================
// CAMADA 1: Polling Rápido (a cada 5 min)
// Primeiro processa fila de retry, depois pedidos novos via cursor
// Máximo 200 pedidos por execução
// ============================================================
export async function pollingRapido(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const MAX_POR_EXECUCAO = 200;

  try {
    await updatePollingState({ status: 'running' });

    // Passo 1: processar fila de retry (prioridade máxima)
    const retryProcessados = await processarFilaRetry();
    pedidosProcessados += retryProcessados;
    if (retryProcessados > 0) {
      console.log(`[rapido] Fila de retry: ${retryProcessados} pedidos reprocessados`);
    }

    const state = await getPollingState();
    const hoje = dataDiasAtras(0);

    // Reseta cursor se mudou de dia
    let cursorId: number = state?.cursor_id ?? 0;
    const cursorData = state?.cursor_data;
    if (!cursorData || cursorData !== hoje) {
      console.log(`[rapido] Novo dia detectado (${cursorData} -> ${hoje}), resetando cursor`);
      cursorId = 0;
    }

    console.log(`[rapido] Buscando pedidos de ${hoje} com id > ${cursorId} (max ${MAX_POR_EXECUCAO})`);

    let offset = 0;
    let lastRateLimit: RateLimitInfo | null = null;
    let maiorIdProcessado = cursorId;

    while (pedidosProcessados < MAX_POR_EXECUCAO) {
      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      const { data: listagem, rateLimit } = await listarPedidos({
        dataAtualizacao: hoje,
        orderBy: 'asc',
        limit: 100,
        offset,
      });

      lastRateLimit = rateLimit;

      if (listagem.itens.length === 0) break;

      // Filtra apenas pedidos com id > cursor
      const novos = listagem.itens.filter(p => p.id > cursorId);

      if (novos.length === 0) {
        // Todos os pedidos desta página já foram processados, avança
        if (offset + 100 < listagem.paginacao.total) {
          offset += 100;
          continue;
        }
        break;
      }

      for (const pedidoResumido of novos) {
        if (pedidosProcessados >= MAX_POR_EXECUCAO) break;
        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        try {
          const { data: pedidoCompleto, rateLimit: rl } = await obterPedido(pedidoResumido.id);
          lastRateLimit = rl;
          await upsertPedido(pedidoCompleto);
          pedidosProcessados++;

          if (pedidoResumido.id > maiorIdProcessado) {
            maiorIdProcessado = pedidoResumido.id;
          }
        } catch (err) {
          console.error(`[rapido] Erro pedido ${pedidoResumido.id}:`, err);
        }
      }

      // Se já processou todos ou atingiu o limite, para
      if (offset + 100 >= listagem.paginacao.total) break;
      offset += 100;
    }

    // Salva o cursor atualizado
    await updatePollingState({
      status: 'idle',
      ultima_verificacao: new Date().toISOString(),
      pedidos_processados: pedidosProcessados,
      erro_mensagem: null,
      cursor_id: maiorIdProcessado,
      cursor_data: hoje,
    });

    console.log(`[rapido] Concluído: ${pedidosProcessados} pedidos, cursor=${maiorIdProcessado}`);
    return { success: true, pedidosProcessados, camada: 'rapido' };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[rapido] Erro fatal:', mensagem);
    await updatePollingState({ status: 'error', pedidos_processados: pedidosProcessados, erro_mensagem: mensagem });
    return { success: false, pedidosProcessados, camada: 'rapido', erro: mensagem };
  }
}

// ============================================================
// CAMADA 2: Atualização de Status (a cada 10 min)
// Monitora apenas pedidos em estados pré-envio (0, 1, 3, 4)
// Webhook assume a partir do status 7 (Enviado)
// Máximo 100 pedidos por execução
// ============================================================
export async function pollingStatus(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const MAX_POR_EXECUCAO = 100;
  // Situações monitoradas pelo polling (pré-envio)
  const SITUACOES_MONITORADAS = [0, 1, 3, 4, 8]; // Aberto, Aprovado, Preparando, Faturado, Dados Incompletos

  try {
    const supabase = createServiceClient();

    // Busca pedidos não-finais em situações monitoradas
    // Ordenados por last_sync_at ASC (mais antigos primeiro, NULLs primeiro)
    // O filtro de 10 min é aplicado no JS para evitar problemas com .or() no PostgREST
    const { data: candidatos, error } = await supabase
      .from('pedidos')
      .select('id, numero_pedido, last_sync_at')
      .eq('situacao_final', false)
      .in('situacao', SITUACOES_MONITORADAS)
      .order('last_sync_at', { ascending: true, nullsFirst: true })
      .limit(MAX_POR_EXECUCAO * 2); // busca mais para filtrar no JS

    if (error) {
      console.error('[status] Erro na query:', error);
      throw error;
    }

    // Filtra: last_sync_at NULL ou > 10 min atrás
    const dezMinAtras = Date.now() - 10 * 60 * 1000;
    const pedidosVivos = (candidatos || []).filter(p => {
      if (!p.last_sync_at) return true;
      return new Date(p.last_sync_at).getTime() < dezMinAtras;
    }).slice(0, MAX_POR_EXECUCAO);
    if (!pedidosVivos || pedidosVivos.length === 0) {
      console.log('[status] Nenhum pedido vivo pendente de atualização');
      return { success: true, pedidosProcessados: 0, camada: 'status' };
    }

    console.log(`[status] ${pedidosVivos.length} pedidos vivos para atualizar`);

    let lastRateLimit: RateLimitInfo | null = null;

    for (const pedido of pedidosVivos) {
      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      try {
        const { data: pedidoCompleto, rateLimit } = await obterPedido(pedido.id);
        lastRateLimit = rateLimit;
        await upsertPedido(pedidoCompleto);
        pedidosProcessados++;
      } catch (err) {
        console.error(`[status] Erro pedido ${pedido.id} (${pedido.numero_pedido}):`, err);
      }
    }

    console.log(`[status] Concluído: ${pedidosProcessados}/${pedidosVivos.length} atualizados`);
    return { success: true, pedidosProcessados, camada: 'status' };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[status] Erro fatal:', mensagem);
    return { success: false, pedidosProcessados, camada: 'status', erro: mensagem };
  }
}

// ============================================================
// CAMADA 3: Reconciliação em 2 fases com checkpoint
// Fase 1: Varredura rápida — compara listagem da Tiny com banco em lote
// Fase 2: Aprofundamento — GET individual só nos divergentes
// Checkpoint permite retomar entre execuções (timeout 240s safety)
// ============================================================
const RECONCILIACAO_TIMEOUT_MS = 240_000; // 240s (margem de 60s antes do timeout Vercel)
const RECONCILIACAO_COOLDOWN_HORAS = 20;
const LOTE_LISTAGEM = 100;

export async function pollingReconciliacao(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const startTime = Date.now();

  try {
    const supabase = createServiceClient();
    const state = await getPollingState();
    const agora = new Date();

    // --- Controle de quando iniciar ---
    const horaUTC = agora.getUTCHours();
    const minutoUTC = agora.getUTCMinutes();
    const dentroJanelaInicio = horaUTC === 4 && minutoUTC < 15;

    const concluidaEm = state?.reconciliacao_concluida_em;
    const jaConcluidaRecentemente = concluidaEm &&
      (agora.getTime() - new Date(concluidaEm).getTime()) < RECONCILIACAO_COOLDOWN_HORAS * 60 * 60 * 1000;

    const checkpointAtivo = state?.reconciliacao_data != null;

    // Safeguard: checkpoint ativo há mais de 6 horas é considerado stale (crash anterior)
    const iniciadaEm = state?.reconciliacao_iniciada_em;
    const checkpointStale = checkpointAtivo && iniciadaEm &&
      (agora.getTime() - new Date(iniciadaEm).getTime()) > 6 * 60 * 60 * 1000;

    // Log diagnóstico sempre
    const horasDesdeConclucao = concluidaEm
      ? ((agora.getTime() - new Date(concluidaEm).getTime()) / (60 * 60 * 1000)).toFixed(1)
      : 'nunca';
    console.log(`[reconciliacao] Diagnóstico: UTC=${horaUTC}:${String(minutoUTC).padStart(2, '0')}, janelaInicio=${dentroJanelaInicio}, checkpointAtivo=${checkpointAtivo}, checkpointStale=${!!checkpointStale}, concluidaRecentemente=${!!jaConcluidaRecentemente} (há ${horasDesdeConclucao}h)`);

    // Se checkpoint está stale, limpar e tratar como sem checkpoint
    if (checkpointStale) {
      console.warn(`[reconciliacao] Checkpoint stale detectado (iniciado em ${iniciadaEm}). Limpando.`);
      await updatePollingState({
        reconciliacao_data: null,
        reconciliacao_offset: 0,
      });
      // Após limpar, segue a lógica normal sem checkpoint
      if (!dentroJanelaInicio || jaConcluidaRecentemente) {
        console.log('[reconciliacao] Decisão: PULAR (checkpoint stale limpo, fora da janela ou concluída recentemente)');
        return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
      }
    }

    // Decisão: continuar checkpoint OU iniciar na janela OU pular
    if (!checkpointAtivo && (!dentroJanelaInicio || jaConcluidaRecentemente)) {
      console.log('[reconciliacao] Decisão: PULAR (sem checkpoint, fora da janela ou concluída recentemente)');
      return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
    }

    console.log(`[reconciliacao] Decisão: RODAR (${checkpointAtivo && !checkpointStale ? 'checkpoint ativo' : 'dentro da janela'})`);

    // --- Inicialização do checkpoint ---
    const datasParaProcessar = [dataDiasAtras(2), dataDiasAtras(1), dataDiasAtras(0)];
    let dataAtual: string;
    let offsetAtual: number;

    if (checkpointAtivo) {
      dataAtual = state.reconciliacao_data;
      offsetAtual = state.reconciliacao_offset || 0;
      // Se a data do checkpoint não está nos últimos 3 dias, reseta
      if (!datasParaProcessar.includes(dataAtual)) {
        dataAtual = datasParaProcessar[0];
        offsetAtual = 0;
      }
      console.log(`[reconciliacao] Continuando checkpoint: data=${dataAtual} offset=${offsetAtual}`);
    } else {
      dataAtual = datasParaProcessar[0];
      offsetAtual = 0;
      await updatePollingState({
        reconciliacao_data: dataAtual,
        reconciliacao_offset: 0,
        reconciliacao_iniciada_em: agora.toISOString(),
      });
      console.log(`[reconciliacao] Iniciando nova reconciliação a partir de ${dataAtual}`);
    }

    // --- Fase 1: Varredura rápida ---
    const pedidosParaAprofundar: number[] = [];
    let lastRateLimit: RateLimitInfo | null = null;
    const indexDataAtual = datasParaProcessar.indexOf(dataAtual);

    for (let di = indexDataAtual; di < datasParaProcessar.length; di++) {
      const data = datasParaProcessar[di];
      let offset = di === indexDataAtual ? offsetAtual : 0;

      while (true) {
        // Timeout safety
        if (Date.now() - startTime > RECONCILIACAO_TIMEOUT_MS) {
          console.log(`[reconciliacao] Timeout safety fase 1. Checkpoint: data=${data} offset=${offset}`);
          await updatePollingState({ reconciliacao_data: data, reconciliacao_offset: offset });
          return { success: true, pedidosProcessados, camada: 'reconciliacao' };
        }

        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        const { data: listagem, rateLimit } = await listarPedidos({
          dataAtualizacao: data,
          orderBy: 'asc',
          limit: LOTE_LISTAGEM,
          offset,
        });
        lastRateLimit = rateLimit;

        if (listagem.itens.length === 0) break;

        // Compara com banco em lote (1 query para N pedidos)
        const idsLote = listagem.itens.map(p => p.id);
        const { data: noBanco } = await supabase
          .from('pedidos')
          .select('id, situacao')
          .in('id', idsLote);

        const mapaBanco = new Map((noBanco || []).map(p => [p.id, p.situacao as number]));

        for (const pedidoTiny of listagem.itens) {
          const situacaoBanco = mapaBanco.get(pedidoTiny.id);

          if (situacaoBanco === undefined) {
            // Pedido não existe no banco
            pedidosParaAprofundar.push(pedidoTiny.id);
          } else if (situacaoBanco !== pedidoTiny.situacao) {
            // Status diferente
            pedidosParaAprofundar.push(pedidoTiny.id);
          }
        }

        offset += LOTE_LISTAGEM;

        // Salva checkpoint após cada página
        await updatePollingState({ reconciliacao_data: data, reconciliacao_offset: offset });

        if (listagem.itens.length < LOTE_LISTAGEM) break;
      }

      console.log(`[reconciliacao] Data ${data} varrida.`);
    }

    console.log(`[reconciliacao] Fase 1 concluída. ${pedidosParaAprofundar.length} pedidos para aprofundar.`);

    // --- Fase 2: Aprofundamento só nos divergentes ---
    for (const idPedido of pedidosParaAprofundar) {
      if (Date.now() - startTime > RECONCILIACAO_TIMEOUT_MS) {
        console.log(`[reconciliacao] Timeout safety fase 2. ${pedidosProcessados} aprofundados.`);
        // Checkpoint já salvo na fase 1, próxima execução reprocessa
        return { success: true, pedidosProcessados, camada: 'reconciliacao' };
      }

      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      try {
        const { data: pedidoCompleto, rateLimit } = await obterPedido(idPedido);
        lastRateLimit = rateLimit;
        await upsertPedido(pedidoCompleto);
        pedidosProcessados++;
      } catch (err) {
        console.error(`[reconciliacao] Erro ao aprofundar pedido ${idPedido}:`, err);
      }
    }

    // --- Conclusão: limpa checkpoint ---
    await updatePollingState({
      reconciliacao_data: null,
      reconciliacao_offset: 0,
      reconciliacao_concluida_em: new Date().toISOString(),
    });

    console.log(`[reconciliacao] Concluída. ${pedidosProcessados} pedidos aprofundados de ${pedidosParaAprofundar.length} divergentes.`);
    return { success: true, pedidosProcessados, camada: 'reconciliacao' };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[reconciliacao] Erro fatal:', mensagem);
    return { success: false, pedidosProcessados, camada: 'reconciliacao', erro: mensagem };
  }
}

// ============================================================
// LEGACY: Mantém executarPolling para compatibilidade com /api/polling
// ============================================================
export async function executarPolling(): Promise<PollingResult> {
  return pollingRapido();
}
