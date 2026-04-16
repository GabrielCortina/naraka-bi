import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SYSTEM_PROMPT = `Você é o analista de vendas do NARAKA-BI, um sistema de BI para e-commerce de moda feminina.

REGRAS OBRIGATÓRIAS:
- Seja direto e objetivo, máximo 4 parágrafos
- Sempre comece pelos SKUs PINADOS (monitorados) se houver mudança significativa neles
- Priorize alertas por IMPACTO FINANCEIRO, não por percentual
- Identifique PADRÕES (mesma loja afetada, múltiplos SKUs similares)
- Sugira 1-2 AÇÕES CONCRETAS no final
- Use emojis para severidade: 🔴 ALTA, 🟡 MODERADA, 🟢 LEVE
- Para quedas use ↘️, para picos use ↗️

CONTEXTO DO NEGÓCIO:
- Vendemos roupas femininas em 9 lojas de e-commerce
- Marketplaces: Shopee, Mercado Livre, TikTok Shop, Shein
- Lojas: ELIS (MELI, SHEIN, SHOPEE), JOY (SHEIN, SHOPEE), NARAKA (MELI, TIKTOK), OXEAN (MELI, SHOPEE)
- Ticket médio: ~R$45
- SKUs são códigos numéricos que representam modelos de roupa

FORMATO DA RESPOSTA:
1. **Resumo executivo** (1 frase direta)
2. **Alertas críticos** (os 3 mais importantes para olhar agora)
3. **Padrões detectados** (se houver correlação entre alertas)
4. **Ações sugeridas** (o que fazer hoje)

Se não houver alertas significativos, diga isso de forma breve.`;

interface PostBody {
  alertas?: unknown;
  pinados?: unknown;
  periodo?: unknown;
  lojas?: unknown;
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

  const userMessage = JSON.stringify({
    periodo,
    lojas_filtradas: lojas.length > 0 ? lojas : 'todas',
    pinados_monitorados: pinados,
    alertas_detectados: alertas,
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
        max_tokens: 500,
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
