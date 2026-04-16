import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SYSTEM_PROMPT = `Você é um analista de BI de operação de marketplaces. Analise os alertas e gere uma leitura clara e acionável.

DADOS RECEBIDOS:
- Alertas: quedas e picos do período
- Breakdown: performance por loja
- Tendências: SKUs em alta/queda consecutiva

ESTRUTURA DA RESPOSTA (use exatamente estas seções):

## Resumo
2-3 linhas sobre o cenário geral: nível de risco, impacto, o que está acontecendo.

## Prioridades
Top 3 SKUs que exigem ação imediata. Formato:
1. SKU XXXXX — motivo (R$ impacto)
2. SKU XXXXX — motivo (R$ impacto)
3. SKU XXXXX — motivo (R$ impacto)

## Tendências Críticas
SKUs com padrão consecutivo:
- ALTA consecutiva (X dias) = risco de ruptura de estoque
- QUEDA consecutiva (X dias) = problema persistente, investigar causa

## Diagnóstico por Loja
Onde estão concentrados os problemas:
- Problema LOCAL = uma loja específica
- Problema SISTÊMICO = múltiplas lojas

## Impacto Financeiro
- Total estimado em quedas: -R$ XX.XXX
- Total estimado em picos: +R$ XX.XXX

## Ações Recomendadas
Lista de 3-5 ações práticas e diretas. Priorizar o que fazer AGORA.

REGRAS DE FORMATAÇÃO:
- Usar ## para títulos de seção (não usar emojis nos títulos)
- Usar **negrito** apenas para SKUs e valores importantes
- Não usar *** ou múltiplos asteriscos
- Listas com - ou números, não misturar
- Ser direto, sem texto genérico
- Se não houver alertas significativos, diga isso de forma breve`;

interface PostBody {
  alertas?: unknown;
  pinados?: unknown;
  periodo?: unknown;
  lojas?: unknown;
  tendencias?: unknown;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 });
  }

  let body: PostBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const alertas = Array.isArray(body.alertas) ? body.alertas : [];
  const pinados = Array.isArray(body.pinados) ? body.pinados : [];
  const periodo = typeof body.periodo === 'string' ? body.periodo : '';
  const lojas = Array.isArray(body.lojas) ? body.lojas : [];
  const tendencias = Array.isArray(body.tendencias) ? body.tendencias : [];

  const userMessage = JSON.stringify({
    periodo,
    lojas_filtradas: lojas.length > 0 ? lojas : 'todas',
    pinados_monitorados: pinados,
    alertas_detectados: alertas,
    tendencias_consecutivas: tendencias,
  }, null, 2);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[alertas/ia] Anthropic API error:', errText);
      return NextResponse.json({ error: `API Anthropic: ${res.status}` }, { status: 502 });
    }

    const json = await res.json();
    const textBlock = json.content?.find((b: { type: string }) => b.type === 'text');
    const analise = textBlock?.text ?? 'Sem resposta da IA';

    return NextResponse.json({
      analise,
      gerado_em: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error('[alertas/ia] exceção:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
