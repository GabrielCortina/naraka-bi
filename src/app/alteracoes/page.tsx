'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { Alteracao } from './lib/types';
import { useAlteracoes } from './hooks/useAlteracoes';
import { AlteracoesHeader } from './components/AlteracoesHeader';
import { AlteracoesFiltros } from './components/AlteracoesFiltros';
import { AlteracoesLista } from './components/AlteracoesLista';
import { AlteracaoModal } from './components/AlteracaoModal';
import { AlteracaoDeleteModal } from './components/AlteracaoDeleteModal';

interface LojaOption {
  nome_exibicao: string;
}

export default function AlteracoesPage() {
  const {
    alteracoes,
    loading,
    error,
    filtros,
    setFiltros,
    limparFiltros,
    lastUpdated,
    criarAlteracao,
    excluirAlteracao,
  } = useAlteracoes();

  const [lojas, setLojas] = useState<LojaOption[]>([]);
  const [modalAberto, setModalAberto] = useState(false);
  const [alteracaoParaExcluir, setAlteracaoParaExcluir] = useState<Alteracao | null>(null);
  const [toast, setToast] = useState<{ msg: string; tipo: 'sucesso' | 'erro' } | null>(null);

  const loadLojas = useCallback(async () => {
    const db = createBrowserClient();
    const { data: configs } = await db.from('loja_config')
      .select('nome_exibicao, nome_loja')
      .eq('ativo', true)
      .order('nome_exibicao');

    if (configs && configs.length > 0) {
      const nomes = configs.map(c => c.nome_loja || c.nome_exibicao);
      const unicos = Array.from(new Set(nomes)).sort();
      setLojas(unicos.map(nome => ({ nome_exibicao: nome })));
    }
  }, []);

  useEffect(() => { loadLojas(); }, [loadLojas]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSalvar = async (data: Parameters<typeof criarAlteracao>[0]) => {
    const res = await criarAlteracao(data);
    if (res.success) {
      setToast({ msg: 'Alteração salva com sucesso', tipo: 'sucesso' });
    }
    return res;
  };

  const handleExcluir = async (id: string) => {
    const res = await excluirAlteracao(id);
    if (res.success) {
      setToast({ msg: 'Alteração excluída', tipo: 'sucesso' });
    }
    return res;
  };

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6">
      <AlteracoesHeader
        lastUpdated={lastUpdated}
        onNovaAlteracao={() => setModalAberto(true)}
      />

      <AlteracoesFiltros
        filtros={filtros}
        onChange={setFiltros}
        onLimpar={limparFiltros}
        lojas={lojas}
      />

      {error && (
        <div className="mb-4 text-xs text-red-500 bg-red-500/10 rounded-md p-3">
          {error}
        </div>
      )}

      <AlteracoesLista
        alteracoes={alteracoes}
        loading={loading}
        onDelete={setAlteracaoParaExcluir}
      />

      <AlteracaoModal
        open={modalAberto}
        onClose={() => setModalAberto(false)}
        onSave={handleSalvar}
        lojas={lojas}
      />

      <AlteracaoDeleteModal
        alteracao={alteracaoParaExcluir}
        onClose={() => setAlteracaoParaExcluir(null)}
        onConfirm={handleExcluir}
      />

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-2 text-sm rounded-md shadow-lg ${
            toast.tipo === 'sucesso'
              ? 'bg-green-500 text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
