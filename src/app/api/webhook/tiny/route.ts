import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// POST /api/webhook/tiny
// Modo discovery: loga o payload completo para descobrir o formato real da Tiny.
// SEMPRE retorna 200.
export async function POST(request: NextRequest) {
  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    // Se não for JSON, tenta ler como texto
    try {
      body = await request.text();
    } catch {
      body = null;
    }
  }

  console.log('[webhook] Payload recebido:', JSON.stringify(body));

  // Loga o payload completo no banco para análise
  try {
    const supabase = createServiceClient();
    const agora = new Date().toISOString();
    await supabase.from('polling_logs').insert({
      camada: 'webhook',
      iniciado_em: agora,
      finalizado_em: agora,
      duracao_ms: 0,
      pedidos_processados: 0,
      pedidos_erro: 0,
      status: 'success',
      erro_mensagem: null,
      detalhes: { payload_raw: body },
    });
  } catch (err) {
    console.error('[webhook] Falha ao salvar log:', err);
  }

  return NextResponse.json({ status: 'ok' });
}
