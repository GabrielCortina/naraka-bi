'use client';

import { useState, useCallback } from 'react';
import type { Alerta, PinadoStatus } from '../lib/types';

interface Tendencia {
  out_sku_pai: string;
  out_dias_consecutivos: number;
  out_variacao_acumulada: number;
  out_direcao: string;
}

interface IAState {
  texto: string | null;
  loading: boolean;
  geradoEm: Date | null;
  error: string | null;
}

function callRpc(rpc: string, params: Record<string, unknown>, loja: string | null) {
  return fetch('/api/dashboard/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rpc,
      params,
      ...(loja ? { loja } : {}),
    }),
  }).then(r => r.json());
}

export function useAlertasIA() {
  const [state, setState] = useState<IAState>({
    texto: null,
    loading: false,
    geradoEm: null,
    error: null,
  });

  const gerarAnalise = useCallback(async (
    alertas: Alerta[],
    pinados: PinadoStatus[],
    periodo: string,
    lojas?: string[],
  ) => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const lojaParam = lojas && lojas.length === 1 ? lojas[0] : null;
      const tendenciaRes = await callRpc('rpc_alertas_tendencia', {}, lojaParam);
      const tendencias = (tendenciaRes.data ?? []) as Tendencia[];

      const res = await fetch('/api/alertas/ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertas,
          pinados,
          periodo,
          lojas,
          tendencias: tendencias.map(t => ({
            sku_pai: t.out_sku_pai,
            dias_consecutivos: t.out_dias_consecutivos,
            variacao_acumulada: t.out_variacao_acumulada,
            direcao: t.out_direcao,
          })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao gerar análise');
      setState({
        texto: json.analise,
        loading: false,
        geradoEm: new Date(json.gerado_em),
        error: null,
      });
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Erro desconhecido',
      }));
    }
  }, []);

  return { ...state, gerarAnalise };
}
