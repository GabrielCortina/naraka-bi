import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ZAPI_INSTANCE = '3F1C14EC428F41EDAB2E0E8BC9274D54';
const ZAPI_TOKEN = '7461620E4B170468446B91B9';
const ZAPI_URL = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;
const DESTINATARIOS = ['5511972785209', '5511972787135'];

const WHATSAPP_PROMPT = `Você é um analista de BI de operação de marketplaces. Gere um relatório matinal de alertas para WhatsApp.

REGRAS DE FORMATAÇÃO (WhatsApp):
- Texto puro, SEM markdown (sem ##, sem **, sem _)
- Use MAIÚSCULAS para títulos de seção
- Use → para bullet points
- Use números para listas ordenadas
- Máximo 1500 caracteres (WhatsApp tem limite)
- Seja extremamente direto

ESTRUTURA:

NARAKA-BI | Relatório [data]

RESUMO
Cenário geral em 1-2 linhas.

PRIORIDADES
1. SKU XXXXX - motivo (R$ impacto)
2. SKU XXXXX - motivo (R$ impacto)
3. SKU XXXXX - motivo (R$ impacto)

TENDÊNCIAS
→ SKUs em alta/queda consecutiva relevante

AÇÕES PARA HOJE
→ Ação 1
→ Ação 2
→ Ação 3

Se não houver alertas relevantes, envie apenas:
"NARAKA-BI | [data] - Sem alertas críticos. Operação estável."`;

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET() {
  try {
    const db = createServiceClient();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });
    }

    const hoje = new Date();
    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const anteontem = new Date(hoje);
    anteontem.setDate(anteontem.getDate() - 2);

    const fmtYmd = (d: Date) => d.toISOString().split('T')[0];
    const ontemStr = fmtYmd(ontem);
    const anteontemStr = fmtYmd(anteontem);

    const [alertasRes, tendenciaRes] = await Promise.all([
      db.rpc('rpc_alertas_calcular', {
        p_periodo_a_inicio: ontemStr,
        p_periodo_a_fim: ontemStr,
        p_periodo_b_inicio: anteontemStr,
        p_periodo_b_fim: anteontemStr,
        p_lojas: null,
        p_ordenar_por: 'score',
      }),
      db.rpc('rpc_alertas_tendencia', { p_lojas: null }),
    ]);

    const alertas = alertasRes.data ?? [];
    const tendencias = tendenciaRes.data ?? [];

    const userMessage = JSON.stringify({
      data_referencia: formatDate(ontem),
      periodo: `${formatDate(ontem)} vs ${formatDate(anteontem)}`,
      alertas_detectados: alertas.slice(0, 15),
      tendencias_consecutivas: tendencias,
    }, null, 2);

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: WHATSAPP_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('[whatsapp] Anthropic error:', errText);
      return NextResponse.json({ error: `API Anthropic: ${aiRes.status}` }, { status: 502 });
    }

    const aiJson = await aiRes.json();
    const textBlock = aiJson.content?.find((b: { type: string }) => b.type === 'text');
    const mensagem = textBlock?.text ?? `NARAKA-BI | ${formatDate(ontem)} - Erro ao gerar análise.`;

    const envios = await Promise.allSettled(
      DESTINATARIOS.map(async (phone) => {
        const zapRes = await fetch(ZAPI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Client-Token': ZAPI_TOKEN },
          body: JSON.stringify({ phone, message: mensagem }),
        });
        if (!zapRes.ok) {
          const err = await zapRes.text();
          throw new Error(`Z-API ${phone}: ${zapRes.status} ${err}`);
        }
        return { phone, status: 'sent' };
      })
    );

    const resultados = envios.map((e, i) => ({
      phone: DESTINATARIOS[i],
      status: e.status === 'fulfilled' ? 'sent' : 'failed',
      error: e.status === 'rejected' ? (e.reason as Error).message : undefined,
    }));

    console.log('[whatsapp] Envios:', JSON.stringify(resultados));

    return NextResponse.json({
      success: true,
      mensagem,
      envios: resultados,
      gerado_em: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[whatsapp] exceção:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
