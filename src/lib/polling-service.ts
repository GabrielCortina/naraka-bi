import { createServiceClient } from './supabase-server';
import { listarPedidos, obterPedido, waitForRateLimit } from './tiny-api';
import type { TinyPedidoFull } from '@/types/tiny';
import type { RateLimitInfo } from './tiny-api';

// Situações finais — pedidos que não mudam mais de status
const SITUACOES_FINAIS = [1, 2, 5, 6, 9]; // Faturada, Cancelada, Enviada, Entregue, Não Entregue

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
// Busca pedidos por data na Tiny, obtém detalhes e faz upsert
// Sem limite de quantidade — usado pela reconciliação
// ============================================================
async function buscarEProcessarPorData(
  data: string,
  label: string
): Promise<number> {
  let offset = 0;
  let processados = 0;
  let lastRateLimit: RateLimitInfo | null = null;

  while (true) {
    if (lastRateLimit) await waitForRateLimit(lastRateLimit);

    const { data: listagem, rateLimit } = await listarPedidos({
      dataAtualizacao: data,
      orderBy: 'asc',
      limit: 100,
      offset,
    });

    lastRateLimit = rateLimit;
    console.log(`[${label}] data=${data} offset=${offset}: ${listagem.itens.length} pedidos (total: ${listagem.paginacao.total})`);

    if (listagem.itens.length === 0) break;

    for (const pedidoResumido of listagem.itens) {
      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      try {
        const { data: pedidoCompleto, rateLimit: rl } = await obterPedido(pedidoResumido.id);
        lastRateLimit = rl;
        await upsertPedido(pedidoCompleto);
        processados++;
      } catch (err) {
        console.error(`[${label}] Erro pedido ${pedidoResumido.id}:`, err);
      }
    }

    if (processados >= listagem.paginacao.total) break;
    offset += 100;
  }

  return processados;
}

// ============================================================
// CAMADA 1: Polling Rápido (a cada 5 min)
// Cursor-based: busca só pedidos com id > cursor_id no dia de hoje
// Máximo 200 pedidos por execução
// ============================================================
export async function pollingRapido(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const MAX_POR_EXECUCAO = 200;

  try {
    await updatePollingState({ status: 'running' });

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
// Busca pedidos "vivos" que não foram sincronizados nos últimos 10 min
// Máximo 50 pedidos por execução
// ============================================================
export async function pollingStatus(): Promise<PollingResult> {
  let pedidosProcessados = 0;
  const MAX_POR_EXECUCAO = 50;

  try {
    const supabase = createServiceClient();

    // Só processa pedidos com situacao_final=false E last_sync_at > 10 min atrás
    const dezMinAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data: pedidosVivos, error } = await supabase
      .from('pedidos')
      .select('id, numero_pedido')
      .eq('situacao_final', false)
      .lt('last_sync_at', dezMinAtras)
      .order('last_sync_at', { ascending: true })
      .limit(MAX_POR_EXECUCAO);

    if (error) throw error;
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
// CAMADA 3: Reconciliação (1x por dia às 3h)
// Busca pedidos dos últimos 3 dias sem limite de quantidade
// ============================================================
export async function pollingReconciliacao(): Promise<PollingResult> {
  let pedidosProcessados = 0;

  try {
    console.log('[reconciliacao] Iniciando reconciliação dos últimos 3 dias');

    for (let i = 2; i >= 0; i--) {
      const data = dataDiasAtras(i);
      const processados = await buscarEProcessarPorData(data, 'reconciliacao');
      pedidosProcessados += processados;
      console.log(`[reconciliacao] ${data}: ${processados} pedidos`);
    }

    console.log(`[reconciliacao] Concluído: ${pedidosProcessados} pedidos total`);
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
