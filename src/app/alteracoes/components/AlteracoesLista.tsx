'use client';

import type { Alteracao } from '../lib/types';
import { AlteracaoCard } from './AlteracaoCard';

interface Props {
  alteracoes: Alteracao[];
  loading: boolean;
  onDelete: (alteracao: Alteracao) => void;
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 animate-pulse">
      {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-40 bg-current/5 rounded-lg" />)}
    </div>
  );
}

export function AlteracoesLista({ alteracoes, loading, onDelete }: Props) {
  if (loading) return <SkeletonCards />;

  if (alteracoes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-current/10 p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nenhuma alteração encontrada.
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Clique em &quot;Nova Alteração&quot; para registrar.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {alteracoes.map(a => (
        <AlteracaoCard key={a.id} alteracao={a} onDelete={onDelete} />
      ))}
    </div>
  );
}
