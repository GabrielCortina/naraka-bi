'use client';

import { useState } from 'react';
import type { Alteracao } from '../lib/types';
import { labelTipo } from '../lib/types';

interface Props {
  alteracao: Alteracao | null;
  onClose: () => void;
  onConfirm: (id: string) => Promise<{ success: boolean; error?: string }>;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function AlteracaoDeleteModal({ alteracao, onClose, onConfirm }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!alteracao) return null;

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    const res = await onConfirm(alteracao.id);
    if (res.success) {
      onClose();
    } else {
      setError(res.error ?? 'Erro ao excluir');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-lg shadow-xl dark:bg-[#0f1117] bg-white border border-current/10"
      >
        <div className="flex items-center justify-between p-4 border-b border-current/10">
          <h2 className="text-base font-semibold">Excluir Alteração</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm">Tem certeza que deseja excluir esta alteração?</p>

          <div className="rounded-md border border-current/10 p-3 text-xs space-y-1 bg-current/5">
            <div><span className="text-gray-500 dark:text-gray-400">SKU:</span> <span className="font-mono">{alteracao.sku}</span></div>
            <div><span className="text-gray-500 dark:text-gray-400">Tipo:</span> {labelTipo(alteracao.tipo_alteracao)}</div>
            <div><span className="text-gray-500 dark:text-gray-400">Data:</span> {formatDate(alteracao.data_alteracao)}</div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Esta ação pode ser revertida pelo administrador.
          </p>

          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded-md p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-4 border-t border-current/10">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-xs rounded-md border border-current/10 hover:border-current/30 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 text-xs font-medium rounded-md bg-red-500 text-white hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {deleting ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
