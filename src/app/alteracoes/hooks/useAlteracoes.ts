'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Alteracao,
  AlteracaoFormData,
  AlteracoesFiltros,
  TipoAlteracao,
} from '../lib/types';

interface RpcRow {
  out_id: string;
  out_data_alteracao: string;
  out_sku: string;
  out_tipo_alteracao: string;
  out_lojas: string[] | null;
  out_valor_antes: string | null;
  out_valor_depois: string | null;
  out_motivo: string | null;
  out_impacto_esperado: string | null;
  out_tags: string[] | null;
  out_observacao: string | null;
  out_responsavel: string | null;
  out_registrado_em: string;
}

function mapRow(r: RpcRow): Alteracao {
  return {
    id: r.out_id,
    data_alteracao: r.out_data_alteracao,
    sku: r.out_sku,
    tipo_alteracao: r.out_tipo_alteracao as TipoAlteracao,
    lojas: r.out_lojas ?? [],
    valor_antes: r.out_valor_antes,
    valor_depois: r.out_valor_depois,
    motivo: r.out_motivo,
    impacto_esperado: r.out_impacto_esperado as Alteracao['impacto_esperado'],
    tags: r.out_tags,
    observacao: r.out_observacao,
    responsavel: r.out_responsavel,
    registrado_em: r.out_registrado_em,
  };
}

const EMPTY_FILTROS: AlteracoesFiltros = {
  dataInicio: null,
  dataFim: null,
  sku: '',
  tipo: '',
  loja: '',
};

export function useAlteracoes() {
  const [alteracoes, setAlteracoes] = useState<Alteracao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtros, setFiltrosState] = useState<AlteracoesFiltros>(EMPTY_FILTROS);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchIdRef = useRef(0);

  const fetchAlteracoes = useCallback(async (f: AlteracoesFiltros) => {
    const currentId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    if (f.dataInicio) qs.set('data_inicio', f.dataInicio);
    if (f.dataFim)    qs.set('data_fim', f.dataFim);
    if (f.sku.trim()) qs.set('sku', f.sku.trim());
    if (f.tipo)       qs.set('tipo', f.tipo);
    if (f.loja)       qs.set('loja', f.loja);

    try {
      const res = await fetch(`/api/alteracoes?${qs.toString()}`);
      const json = await res.json();

      if (currentId !== fetchIdRef.current) return;

      if (!json.success) {
        setError(json.error ?? 'Erro ao carregar alterações');
        setAlteracoes([]);
      } else {
        setAlteracoes((json.data as RpcRow[]).map(mapRow));
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (currentId !== fetchIdRef.current) return;
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
      setAlteracoes([]);
    } finally {
      if (currentId === fetchIdRef.current) setLoading(false);
    }
  }, []);

  const setFiltros = useCallback((f: AlteracoesFiltros) => {
    setFiltrosState(f);
    fetchAlteracoes(f);
  }, [fetchAlteracoes]);

  const limparFiltros = useCallback(() => {
    setFiltros(EMPTY_FILTROS);
  }, [setFiltros]);

  useEffect(() => {
    fetchAlteracoes(EMPTY_FILTROS);
  }, [fetchAlteracoes]);

  const criarAlteracao = useCallback(async (data: AlteracaoFormData): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/alteracoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!json.success) return { success: false, error: json.error ?? 'Erro ao salvar' };
      await fetchAlteracoes(filtros);
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
    }
  }, [fetchAlteracoes, filtros]);

  const excluirAlteracao = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`/api/alteracoes/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) return { success: false, error: json.error ?? 'Erro ao excluir' };
      setAlteracoes(prev => prev.filter(a => a.id !== id));
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' };
    }
  }, []);

  return {
    alteracoes,
    loading,
    error,
    filtros,
    setFiltros,
    limparFiltros,
    lastUpdated,
    refetch: () => fetchAlteracoes(filtros),
    criarAlteracao,
    excluirAlteracao,
  };
}
