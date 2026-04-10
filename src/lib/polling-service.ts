import { createServiceClient } from './supabase-server';
import { listarPedidos, obterPedido, waitForRateLimit } from './tiny-api';
import type { TinyPedidoFull } from '@/types/tiny';
import type { RateLimitInfo } from './tiny-api';

interface PollingResult {
  success: boolean;
  pedidosProcessados: number;
  erro?: string;
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

// Converte strings vazias para null (a Tiny retorna "" em campos opcionais)
function emptyToNull<T>(value: T): T | null {
  if (value === '' || value === undefined || value === null) return null;
  return value;
}

// Salva ou atualiza um pedido completo no banco
async function upsertPedido(pedido: TinyPedidoFull) {
  const supabase = createServiceClient();

  // Upsert do pedido principal
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
    data_pedido: emptyToNull(pedido.data) || new Date().toISOString().split('T')[0],
    data_entrega: emptyToNull(pedido.dataEntrega),
    data_prevista: emptyToNull(pedido.dataPrevista),
    data_envio: emptyToNull(pedido.dataEnvio),
    observacoes: emptyToNull(pedido.observacoes),
    observacoes_internas: emptyToNull(pedido.observacoesInternas),
    numero_ordem_compra: emptyToNull(pedido.numeroOrdemCompra),
    origem_pedido: pedido.origemPedido ?? 0,
    // Cliente
    cliente_id: pedido.cliente?.id ?? null,
    cliente_nome: emptyToNull(pedido.cliente?.nome),
    cliente_cpf_cnpj: emptyToNull(pedido.cliente?.cpfCnpj),
    cliente_email: emptyToNull(pedido.cliente?.email),
    // E-commerce
    ecommerce_id: pedido.ecommerce?.id ?? null,
    ecommerce_nome: emptyToNull(pedido.ecommerce?.nome),
    numero_pedido_ecommerce: emptyToNull(pedido.ecommerce?.numeroPedidoEcommerce),
    canal_venda: emptyToNull(pedido.ecommerce?.canalVenda),
    // Transportador
    transportador_id: pedido.transportador?.id ?? null,
    transportador_nome: emptyToNull(pedido.transportador?.nome),
    codigo_rastreamento: emptyToNull(pedido.transportador?.codigoRastreamento),
    // Vendedor
    vendedor_id: pedido.vendedor?.id ?? null,
    vendedor_nome: emptyToNull(pedido.vendedor?.nome),
    // Pagamento
    forma_pagamento: emptyToNull(pedido.pagamento?.formaRecebimento),
    meio_pagamento: emptyToNull(pedido.pagamento?.meioPagamento),
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

// Executa um ciclo de polling completo
export async function executarPolling(): Promise<PollingResult> {
  let pedidosProcessados = 0;

  try {
    await updatePollingState({ status: 'running' });

    // Sempre busca pedidos atualizados no dia de hoje
    const hoje = new Date().toISOString();

    console.log(`[polling] Buscando pedidos atualizados em ${hoje.split('T')[0]}`);

    let offset = 0;
    let totalProcessado = 0;
    let lastRateLimit: RateLimitInfo | null = null;

    // Pagina pelos resultados
    while (true) {
      if (lastRateLimit) await waitForRateLimit(lastRateLimit);

      const { data: listagem, rateLimit } = await listarPedidos({
        dataAtualizacao: hoje,
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
      ultima_verificacao: hoje,
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
