import { createServiceClient } from './supabase-server';
import { listarPedidos, obterPedido, waitForRateLimit } from './tiny-api';
import type { TinyPedidoFull } from '@/types/tiny';
import type { RateLimitInfo } from './tiny-api';

// Situações realmente finais — pedido não muda mais
// 2=Cancelada, 6=Entregue, 9=Nao Entregue
const SITUACOES_FINAIS = [2, 6, 9];

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

export async function processarFilaRetry(): Promise<PollingResult> {
  const supabase = createServiceClient();
  let processados = 0;

  try {
    const { data: filaItems } = await supabase
      .from('webhook_retry_queue')
      .select('*')
      .eq('processado', false)
      .lte('proxima_tentativa', new Date().toISOString())
      .order('proxima_tentativa', { ascending: true })
      .limit(20);

    if (!filaItems || filaItems.length === 0) {
      return { success: true, pedidosProcessados: 0, camada: 'retry' };
    }

    console.log(`[retry] ${filaItems.length} itens na fila de retry`);

    for (const item of filaItems) {
      try {
        const { data: pedidoCompleto } = await obterPedido(item.id_pedido);
        await upsertPedido(pedidoCompleto);

        await supabase.from('webhook_retry_queue')
          .update({ processado: true, ultimo_erro: null })
          .eq('id', item.id);

        console.log(`[retry] Sucesso: pedido ${item.id_pedido}`);
        processados++;

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Erro desconhecido';
        const novasTentativas = (item.tentativas || 0) + 1;

        if (novasTentativas >= MAX_TENTATIVAS_TOTAL) {
          await supabase.from('webhook_retry_queue')
            .update({
              processado: true,
              dead_letter: true,
              tentativas: novasTentativas,
              ultimo_erro: `Desistido após ${MAX_TENTATIVAS_TOTAL} tentativas: ${msg}`,
            })
            .eq('id', item.id);
          console.error(`[retry] DEAD LETTER: pedido ${item.id_pedido} desistido após ${MAX_TENTATIVAS_TOTAL} tentativas`);
        } else {
          const proximaTentativa = new Date(Date.now() + novasTentativas * 5 * 60 * 1000).toISOString();
          await supabase.from('webhook_retry_queue')
            .update({
              tentativas: novasTentativas,
              ultimo_erro: msg,
              proxima_tentativa: proximaTentativa,
            })
            .eq('id', item.id);
          console.warn(`[retry] Falhou (${novasTentativas}/${MAX_TENTATIVAS_TOTAL}): pedido ${item.id_pedido}. Próxima: ${proximaTentativa}`);
        }
      }
    }

    console.log(`[retry] Concluído: ${processados} pedidos reprocessados`);
    return { success: true, pedidosProcessados: processados, camada: 'retry' };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[retry] Erro fatal:', mensagem);
    return { success: false, pedidosProcessados: processados, camada: 'retry', erro: mensagem };
  }
}

// ============================================================
// CAMADA 1: Polling Rápido (a cada 5 min)
// Busca pedidos novos via cursor-based pagination
// Máximo 200 pedidos por execução
// ============================================================
export async function pollingRapido(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const MAX_POR_EXECUCAO = 200;
  const startTime = Date.now();
  const TIMEOUT_MS = 240_000; // 240s safety (margem de 60s antes do timeout Vercel)

  try {
    const state = await getPollingState();

    // Verifica lock stale: se status='running' há mais de 10 min, considera crash anterior
    if (state?.status === 'running' && state?.updated_at) {
      const minDesdeUpdate = (Date.now() - new Date(state.updated_at).getTime()) / 60_000;
      if (minDesdeUpdate < 10) {
        console.log(`[rapido] Outra instância rodando (updated_at ${Math.round(minDesdeUpdate)}min atrás). Pulando.`);
        return { success: true, pedidosProcessados: 0, camada: 'rapido' };
      }
      console.warn(`[rapido] Lock stale detectado (${Math.round(minDesdeUpdate)}min). Assumindo crash anterior.`);
    }

    await updatePollingState({ status: 'running' });

    const hoje = dataDiasAtras(0);
    const ontem = dataDiasAtras(1);

    // Reseta cursor se mudou de dia
    let cursorId: number = state?.cursor_id ?? 0;
    const cursorData = state?.cursor_data;
    const mudouDeDia = !cursorData || cursorData !== hoje;
    if (mudouDeDia) {
      console.log(`[rapido] Novo dia detectado (${cursorData} -> ${hoje}), resetando cursor`);
      cursorId = 0;
    }

    // Gap meia-noite: nas primeiras execuções após mudança de dia, buscar ontem também
    const datasParaBuscar = mudouDeDia && cursorData === ontem ? [ontem, hoje] : [hoje];
    console.log(`[rapido] Buscando pedidos de ${datasParaBuscar.join(', ')} com id > ${cursorId} (max ${MAX_POR_EXECUCAO})`);

    let lastRateLimit: RateLimitInfo | null = null;
    let maiorIdProcessado = cursorId;

    for (const dataBusca of datasParaBuscar) {
      let offset = 0;

      while (pedidosProcessados < MAX_POR_EXECUCAO) {
        // Timeout safety
        if (Date.now() - startTime > TIMEOUT_MS) {
          console.log(`[rapido] Timeout safety atingido (${Math.round((Date.now() - startTime) / 1000)}s). Parando.`);
          break;
        }

        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        const { data: listagem, rateLimit } = await listarPedidos({
          dataAtualizacao: dataBusca,
          orderBy: 'asc',
          limit: 100,
          offset,
        });

        lastRateLimit = rateLimit;

        if (listagem.itens.length === 0) break;

        // Filtra apenas pedidos com id > cursor (para data de hoje; para ontem processa todos)
        const novos = dataBusca === hoje
          ? listagem.itens.filter(p => p.id > cursorId)
          : listagem.itens;

        if (novos.length === 0) {
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

            if (dataBusca === hoje && pedidoResumido.id > maiorIdProcessado) {
              maiorIdProcessado = pedidoResumido.id;
            }
          } catch (err) {
            console.error(`[rapido] Erro pedido ${pedidoResumido.id}:`, err);
          }
        }

        if (offset + 100 >= listagem.paginacao.total) break;
        offset += 100;
      }

      if (pedidosProcessados >= MAX_POR_EXECUCAO) break;
      if (Date.now() - startTime > TIMEOUT_MS) break;
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
// Início: 00h Brasil (3h UTC) — parada obrigatória: 8h Brasil (11h UTC)
// Fase 1: Varredura rápida — compara listagem da Tiny com banco em lote
// Fase 2: Aprofundamento — GET individual só nos divergentes
// Checkpoint permite retomar entre execuções (timeout 240s safety)
// Relatório salvo em reconciliacao_relatorio
// ============================================================
const RECONCILIACAO_TIMEOUT_MS = 240_000; // 240s (margem de 60s antes do timeout Vercel)
const RECONCILIACAO_COOLDOWN_HORAS = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function atualizarRelatorio(supabase: any, relatorioId: number | null, dados: Record<string, unknown>) {
  if (!relatorioId) return;
  await supabase.from('reconciliacao_relatorio').update(dados).eq('id', relatorioId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function salvarRelatorioFinal(supabase: any, relatorioId: number | null, dados: Record<string, unknown>) {
  if (!relatorioId) return;
  await supabase.from('reconciliacao_relatorio').update({
    ...dados,
    finalizada_em: new Date().toISOString(),
  }).eq('id', relatorioId);
}

async function salvarRelatorioInterrompido() {
  const supabase = createServiceClient();
  await supabase.from('reconciliacao_relatorio')
    .update({
      status: 'interrompida',
      finalizada_em: new Date().toISOString(),
      observacao: 'Interrompida por limite de horario (8h Brasil / 11h UTC)',
    })
    .eq('status', 'em_andamento');
}

export async function pollingReconciliacao(): Promise<PollingResult> {
  const supabase = createServiceClient();
  const agora = new Date();
  const horaUTC = agora.getUTCHours();
  const minutoUTC = agora.getUTCMinutes();
  const state = await getPollingState();

  // --- LIMITE DE 8H BRASIL (11h UTC) ---
  const passouLimite8h = horaUTC >= 11;
  const checkpointAtivo = state?.reconciliacao_data != null;

  // Log diagnostico sempre
  console.log(`[reconciliacao] UTC=${horaUTC}:${String(minutoUTC).padStart(2, '0')}, checkpoint=${checkpointAtivo}, passouLimite8h=${passouLimite8h}`);

  // Se passou das 8h Brasil E tem checkpoint ativo: interromper e salvar relatorio
  if (passouLimite8h && checkpointAtivo) {
    console.log('[reconciliacao] Passou das 8h Brasil. Interrompendo e salvando relatorio.');
    await salvarRelatorioInterrompido();
    await updatePollingState({
      reconciliacao_data: null,
      reconciliacao_offset: 0,
    });
    return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
  }

  // Se passou das 8h Brasil E não tem checkpoint: não faz nada
  if (passouLimite8h && !checkpointAtivo) {
    return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
  }

  // --- VERIFICACAO DE INICIO ---
  // Deve iniciar às 3h00-3h14 UTC (00h Brasil) OU continuar checkpoint ativo
  const deveIniciar = horaUTC === 3 && minutoUTC <= 14;
  const concluidaEm = state?.reconciliacao_concluida_em;
  const jaConcluidaRecentemente = concluidaEm &&
    (agora.getTime() - new Date(concluidaEm).getTime()) < RECONCILIACAO_COOLDOWN_HORAS * 60 * 60 * 1000;

  if (!checkpointAtivo && !deveIniciar) {
    return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
  }

  if (!checkpointAtivo && jaConcluidaRecentemente) {
    console.log('[reconciliacao] Ja concluida recentemente. Pulando.');
    return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
  }

  // --- INICIALIZACAO ---
  const datasParaProcessar = [dataDiasAtras(2), dataDiasAtras(1), dataDiasAtras(0)];
  let dataAtual: string;
  let offsetAtual: number;
  let relatorioId: number | null = null;
  let contadoresAcumulados: { varridos: number; divergentes: number; corrigidos: number; diasProcessados: number } | null = null;

  if (checkpointAtivo) {
    dataAtual = state.reconciliacao_data;
    offsetAtual = state.reconciliacao_offset || 0;
    // Se a data do checkpoint nao esta nos ultimos 3 dias, reseta
    if (!datasParaProcessar.includes(dataAtual)) {
      dataAtual = datasParaProcessar[0];
      offsetAtual = 0;
    }
    // Busca relatorio em andamento e carrega contadores acumulados
    const { data: rel } = await supabase
      .from('reconciliacao_relatorio')
      .select('id, pedidos_varridos, pedidos_divergentes, pedidos_corrigidos, dias_processados')
      .eq('status', 'em_andamento')
      .order('iniciada_em', { ascending: false })
      .limit(1)
      .maybeSingle();
    relatorioId = rel?.id || null;
    // Restaura contadores acumulados de execucoes anteriores
    contadoresAcumulados = {
      varridos: rel?.pedidos_varridos || 0,
      divergentes: rel?.pedidos_divergentes || 0,
      corrigidos: rel?.pedidos_corrigidos || 0,
      diasProcessados: rel?.dias_processados || 0,
    };
    console.log(`[reconciliacao] Continuando checkpoint: data=${dataAtual} offset=${offsetAtual}, acumulados: ${contadoresAcumulados.varridos} varridos, ${contadoresAcumulados.divergentes} divergentes`);
  } else {
    dataAtual = datasParaProcessar[0];
    offsetAtual = 0;
    // Cria novo relatorio
    const { data: novoRel } = await supabase
      .from('reconciliacao_relatorio')
      .insert({
        iniciada_em: agora.toISOString(),
        status: 'em_andamento',
        dias_total: 3,
      })
      .select('id')
      .single();
    relatorioId = novoRel?.id || null;
    await updatePollingState({
      reconciliacao_data: dataAtual,
      reconciliacao_offset: 0,
      reconciliacao_iniciada_em: agora.toISOString(),
      reconciliacao_concluida_em: null,
    });
    // Limpa divergentes anteriores ao iniciar nova reconciliacao
    await supabase.from('reconciliacao_divergentes').delete().eq('processado', false);
    await supabase.from('reconciliacao_divergentes').delete().eq('processado', true);
    console.log(`[reconciliacao] Iniciando nova reconciliacao. Relatorio ID: ${relatorioId}`);
  }

  // --- FASE 1: Varredura rapida ---
  let divergentesNestaExecucao = 0;
  let lastRateLimit: RateLimitInfo | null = null;
  const indexDataAtual = datasParaProcessar.indexOf(dataAtual);
  // Contadores iniciam com valores acumulados de execucoes anteriores (checkpoint)
  let pedidosVarridos = checkpointAtivo ? (contadoresAcumulados?.varridos ?? 0) : 0;
  let diasProcessados = checkpointAtivo ? (contadoresAcumulados?.diasProcessados ?? 0) : 0;
  const startTime = Date.now();

  try {
    for (let di = indexDataAtual; di < datasParaProcessar.length; di++) {
      const data = datasParaProcessar[di];
      let offset = di === indexDataAtual ? offsetAtual : 0;

      // Verifica limite de 8h antes de cada dia
      if (new Date().getUTCHours() >= 11) {
        console.log('[reconciliacao] Chegou as 8h Brasil durante fase 1. Salvando checkpoint.');
        await updatePollingState({ reconciliacao_data: data, reconciliacao_offset: offset });
        const { count: totalDivergentes } = await supabase
          .from('reconciliacao_divergentes').select('*', { count: 'exact', head: true }).eq('processado', false);
        await atualizarRelatorio(supabase, relatorioId, {
          pedidos_varridos: pedidosVarridos,
          pedidos_divergentes: (totalDivergentes || 0) + divergentesNestaExecucao,
          ultimo_checkpoint_data: data,
          ultimo_checkpoint_offset: offset,
          dias_processados: diasProcessados,
        });
        return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
      }

      while (true) {
        // Timeout safety (240s Vercel)
        if (Date.now() - startTime > RECONCILIACAO_TIMEOUT_MS) {
          console.log(`[reconciliacao] Timeout safety fase 1. Checkpoint: data=${data} offset=${offset}`);
          await updatePollingState({ reconciliacao_data: data, reconciliacao_offset: offset });
          const { count: totalDivergentes } = await supabase
            .from('reconciliacao_divergentes').select('*', { count: 'exact', head: true }).eq('processado', false);
          await atualizarRelatorio(supabase, relatorioId, {
            pedidos_varridos: pedidosVarridos,
            pedidos_divergentes: (totalDivergentes || 0),
            ultimo_checkpoint_data: data,
            ultimo_checkpoint_offset: offset,
            dias_processados: diasProcessados,
          });
          return { success: true, pedidosProcessados: 0, camada: 'reconciliacao' };
        }

        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        const { data: listagem, rateLimit } = await listarPedidos({
          dataAtualizacao: data,
          orderBy: 'asc',
          limit: 100,
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

        // Insere divergentes diretamente no banco (persistidos entre checkpoints)
        const divergentesLote: { id_pedido: number; processado: boolean }[] = [];
        for (const pedidoTiny of listagem.itens) {
          const situacaoBanco = mapaBanco.get(pedidoTiny.id);
          if (situacaoBanco === undefined || situacaoBanco !== pedidoTiny.situacao) {
            divergentesLote.push({ id_pedido: pedidoTiny.id, processado: false });
          }
          pedidosVarridos++;
        }
        if (divergentesLote.length > 0) {
          await supabase.from('reconciliacao_divergentes')
            .upsert(divergentesLote, { onConflict: 'id_pedido' });
          divergentesNestaExecucao += divergentesLote.length;
        }

        offset += 100;
        await updatePollingState({ reconciliacao_data: data, reconciliacao_offset: offset });

        if (listagem.itens.length < 100) break;
      }

      diasProcessados++;
      console.log(`[reconciliacao] Data ${data} varrida. Divergentes nesta execucao: ${divergentesNestaExecucao}`);
    }

    // --- FASE 2: Aprofundamento (busca divergentes do banco, nao da memoria) ---
    let pedidosCorrigidos = checkpointAtivo ? (contadoresAcumulados?.corrigidos ?? 0) : 0;
    const { count: totalDivergentes } = await supabase
      .from('reconciliacao_divergentes').select('*', { count: 'exact', head: true }).eq('processado', false);
    const numDivergentes = totalDivergentes || 0;
    console.log(`[reconciliacao] Fase 2: ${numDivergentes} pedidos divergentes para aprofundar`);

    while (true) {
      // Busca lote de divergentes nao processados
      const { data: divergentes } = await supabase
        .from('reconciliacao_divergentes')
        .select('id_pedido')
        .eq('processado', false)
        .order('id_pedido', { ascending: true })
        .limit(50);

      if (!divergentes || divergentes.length === 0) break;

      for (const item of divergentes) {
        // Verifica limite de 8h
        if (new Date().getUTCHours() >= 11) {
          const { count: faltaramCount } = await supabase
            .from('reconciliacao_divergentes').select('*', { count: 'exact', head: true }).eq('processado', false);
          const faltaram = faltaramCount || 0;
          console.log(`[reconciliacao] Chegou as 8h Brasil durante fase 2. Faltaram ${faltaram} pedidos.`);
          await salvarRelatorioFinal(supabase, relatorioId, {
            status: 'interrompida',
            pedidos_varridos: pedidosVarridos,
            pedidos_divergentes: numDivergentes + divergentesNestaExecucao,
            pedidos_corrigidos: pedidosCorrigidos,
            pedidos_faltaram: faltaram,
            dias_processados: diasProcessados,
            observacao: `Interrompida as 8h Brasil. ${faltaram} pedidos divergentes nao processados.`,
          });
          await updatePollingState({ reconciliacao_data: null, reconciliacao_offset: 0 });
          return { success: true, pedidosProcessados: pedidosCorrigidos, camada: 'reconciliacao' };
        }

        // Timeout safety
        if (Date.now() - startTime > RECONCILIACAO_TIMEOUT_MS) {
          const { count: faltaramCount } = await supabase
            .from('reconciliacao_divergentes').select('*', { count: 'exact', head: true }).eq('processado', false);
          await atualizarRelatorio(supabase, relatorioId, {
            pedidos_varridos: pedidosVarridos,
            pedidos_divergentes: numDivergentes + divergentesNestaExecucao,
            pedidos_corrigidos: pedidosCorrigidos,
            pedidos_faltaram: faltaramCount || 0,
            dias_processados: diasProcessados,
          });
          return { success: true, pedidosProcessados: pedidosCorrigidos, camada: 'reconciliacao' };
        }

        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        try {
          const { data: pedidoCompleto, rateLimit } = await obterPedido(item.id_pedido);
          lastRateLimit = rateLimit;
          await upsertPedido(pedidoCompleto);
          pedidosCorrigidos++;
        } catch (err) {
          console.error(`[reconciliacao] Erro ao aprofundar pedido ${item.id_pedido}:`, err);
        }

        // Marca divergente como processado no banco
        await supabase.from('reconciliacao_divergentes')
          .update({ processado: true })
          .eq('id_pedido', item.id_pedido);
      }
    }

    // --- CONCLUSAO: limpa divergentes e finaliza ---
    await supabase.from('reconciliacao_divergentes').delete().eq('processado', true);
    await salvarRelatorioFinal(supabase, relatorioId, {
      status: 'concluida',
      pedidos_varridos: pedidosVarridos,
      pedidos_divergentes: numDivergentes + divergentesNestaExecucao,
      pedidos_corrigidos: pedidosCorrigidos,
      pedidos_faltaram: 0,
      dias_processados: 3,
      observacao: `Concluida com sucesso. ${pedidosCorrigidos} pedidos corrigidos.`,
    });
    await updatePollingState({
      reconciliacao_data: null,
      reconciliacao_offset: 0,
      reconciliacao_concluida_em: new Date().toISOString(),
    });

    console.log(`[reconciliacao] Concluida. ${pedidosCorrigidos} corrigidos de ${pedidosVarridos} varridos.`);
    return { success: true, pedidosProcessados: pedidosCorrigidos, camada: 'reconciliacao' };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[reconciliacao] Erro fatal:', mensagem);
    return { success: false, pedidosProcessados: 0, camada: 'reconciliacao', erro: mensagem };
  }
}

// ============================================================
// LEGACY: Mantém executarPolling para compatibilidade com /api/polling
// ============================================================
export async function executarPolling(): Promise<PollingResult> {
  return pollingRapido();
}
