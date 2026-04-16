'use client';

import { useState, useCallback } from 'react';
import type { Alerta, PinadoStatus } from '../lib/types';

interface IAState {
  texto: string | null;
  loading: boolean;
  geradoEm: Date | null;
  error: string | null;
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
      const res = await fetch('/api/alertas/ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertas, pinados, periodo, lojas }),
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
