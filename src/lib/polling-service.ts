import { createServiceClient } from './supabase-server';
import { listarPedidos, obterPedido, waitForRateLimit } from './tiny-api';
import type { TinyPedidoFull } from '@/types/tiny';
import type { RateLimitInfo } from './tiny-api';

interface PollingResult {
  success: boolean;
  pedidosProcessados: number;
  erro?: string;
}

// Busca o estado do último polling
async function getPollingState() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('polling_state')
    .select('*')
    .eq('id', 1)
    .single();

  return data;
}

// Atualiza o estado do polling
async function updatePollingState(updates: {
  ultima_verificacao?: string;
  pedidos_processados?: number;
  status: 'idle' | 'running' | 'error';
  erro_mensagem?: string | null;
}) {
  const supabase = createServiceClient();
  await supabase.from('polling_state').upsert({
    id: 1,
    ...updates,
    updated_at: new Date().toISOString(),
  });
}

// Salva ou atualiza um pedido completo no banco
async function upsertPedido(pedido: TinyPedidoFull) {
  const supabase = createServiceClient();

  // Upsert do pedido principal
  const { error: pedidoError } = await supabase.from('pedidos').upsert({
    id: pedido.id,
    numero_pedido: pedido.numeroPedido,
    id_nota_fiscal: pedido.idNotaFiscal,
    data_faturamento: pedido.dataFaturamento,
    valor_total_produtos: pedido.valorTotalProdutos,
    valor_total_pedido: pedido.valorTotalPedido,
    valor_desconto: pedido.valorDesconto,
    valor_frete: pedido.valorFrete,
    valor_outras_despesas: pedido.valorOutrasDespesas,
    situacao: pedido.situacao,
    data_pedido: pedido.data,
    data_entrega: pedido.dataEntrega,
    data_prevista: pedido.dataPrevista,
    data_envio: pedido.dataEnvio,
    observacoes: pedido.observacoes,
    observacoes_internas: pedido.observacoesInternas,
    numero_ordem_compra: pedido.numeroOrdemCompra,
    origem_pedido: pedido.origemPedido,
    // Cliente
    cliente_id: pedido.cliente?.id ?? null,
    cliente_nome: pedido.cliente?.nome ?? null,
    cliente_cpf_cnpj: pedido.cliente?.cpfCnpj ?? null,
    cliente_email: pedido.cliente?.email ?? null,
    // E-commerce
    ecommerce_id: pedido.ecommerce?.id ?? null,
    ecommerce_nome: pedido.ecommerce?.nome ?? null,
    numero_pedido_ecommerce: pedido.ecommerce?.numeroPedidoEcommerce ?? null,
    canal_venda: pedido.ecommerce?.canalVenda ?? null,
    // Transportador
    transportador_id: pedido.transportador?.id ?? null,
    transportador_nome: pedido.transportador?.nome ?? null,
    codigo_rastreamento: pedido.transportador?.codigoRastreamento ?? null,
    // Vendedor
    vendedor_id: pedido.vendedor?.id ?? null,
    vendedor_nome: pedido.vendedor?.nome ?? null,
    // Pagamento
    forma_pagamento: pedido.pagamento?.formaRecebimento ?? null,
    meio_pagamento: pedido.pagamento?.meioPagamento ?? null,
    // JSON completo para consultas avançadas
    raw_data: pedido as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  });

  if (pedidoError) {
    console.error(`[polling] Erro ao salvar pedido ${pedido.id}:`, pedidoError);
    throw pedidoError;
  }

  // Deleta itens antigos e insere os novos (replace completo)
  if (pedido.itens && pedido.itens.length > 0) {
    await supabase.from('pedido_itens').delete().eq('pedido_id', pedido.id);

    const itens = pedido.itens.map(item => ({
      pedido_id: pedido.id,
      produto_id: item.produto.id,
      sku: item.produto.sku,
      descricao: item.produto.descricao,
      tipo_produto: item.produto.tipo,
      quantidade: item.quantidade,
      valor_unitario: item.valorUnitario,
      valor_total: item.quantidade * item.valorUnitario,
      info_adicional: item.infoAdicional,
    }));

    const { error: itensError } = await supabase.from('pedido_itens').insert(itens);
    if (itensError) {
      console.error(`[polling] Erro ao salvar itens do pedido ${pedido.id}:`, itensError);
    }
  }
}

// Executa um ciclo de polling completo
export async function executarPolling(): Promise<PollingResult> {
  let pedidosProcessados = 0;

  try {
    await updatePollingState({ status: 'running' });

    const state = await getPollingState();
    const ultimaVerificacao = state?.ultima_verificacao || '2024-01-01T00:00:00';

    console.log(`[polling] Iniciando busca desde ${ultimaVerificacao}`);

    let offset = 0;
    let totalProcessado = 0;
    let lastRateLimit: RateLimitInfo | null = null;
    const agora = new Date().toISOString();

    // Pagina pelos resultados
    while (true) {
      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      const { data: listagem, rateLimit } = await listarPedidos({
        dataAtualizacao: ultimaVerificacao,
        orderBy: 'asc',
        limit: 100,
        offset,
      });

      lastRateLimit = rateLimit;
      console.log(`[polling] Página offset=${offset}: ${listagem.itens.length} pedidos (total: ${listagem.paginacao.total})`);

      if (listagem.itens.length === 0) break;

      // Para cada pedido, busca detalhes completos
      for (const pedidoResumido of listagem.itens) {
        if (lastRateLimit) await waitForRateLimit(lastRateLimit);

        try {
          const { data: pedidoCompleto, rateLimit: rl } = await obterPedido(pedidoResumido.id);
          lastRateLimit = rl;

          await upsertPedido(pedidoCompleto);
          pedidosProcessados++;
          totalProcessado++;

          console.log(`[polling] Pedido ${pedidoCompleto.numeroPedido} (${pedidoResumido.id}) salvo`);
        } catch (err) {
          console.error(`[polling] Erro ao processar pedido ${pedidoResumido.id}:`, err);
          // Continua com o próximo pedido
        }
      }

      // Se já processou tudo, para
      if (totalProcessado >= listagem.paginacao.total) break;
      offset += 100;
    }

    await updatePollingState({
      status: 'idle',
      ultima_verificacao: agora,
      pedidos_processados: pedidosProcessados,
      erro_mensagem: null,
    });

    console.log(`[polling] Concluído: ${pedidosProcessados} pedidos processados`);
    return { success: true, pedidosProcessados };

  } catch (err) {
    const mensagem = err instanceof Error ? err.message : 'Erro desconhecido';
    console.error('[polling] Erro fatal:', mensagem);

    await updatePollingState({
      status: 'error',
      pedidos_processados: pedidosProcessados,
      erro_mensagem: mensagem,
    });

    return { success: false, pedidosProcessados, erro: mensagem };
  }
}
