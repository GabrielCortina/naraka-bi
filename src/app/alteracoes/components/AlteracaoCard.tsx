'use client';

import type { Alteracao } from '../lib/types';
import { iconTipo, labelTipo } from '../lib/types';

interface Props {
  alteracao: Alteracao;
  onDelete: (alteracao: Alteracao) => void;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  );
}

const IMPACTO_STYLES: Record<string, string> = {
  alta:   'bg-green-500/15 text-green-700 dark:text-green-300',
  queda:  'bg-red-500/15 text-red-700 dark:text-red-300',
  neutro: 'bg-gray-500/15 text-gray-700 dark:text-gray-300',
};

const IMPACTO_LABEL: Record<string, string> = {
  alta:   'Impacto: alta',
  queda:  'Impacto: queda',
  neutro: 'Impacto: neutro',
};

export function AlteracaoCard({ alteracao, onDelete }: Props) {
  const a = alteracao;
  const icone = iconTipo(a.tipo_alteracao);
  const tipoLabel = labelTipo(a.tipo_alteracao);

  return (
    <div className="rounded-lg border border-current/10 p-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
      {/* Header: data + excluir */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
          <span>📅</span>
          {formatDate(a.data_alteracao)}
        </span>
        <button
          onClick={() => onDelete(a)}
          title="Excluir alteração"
          className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
        >
          <TrashIcon />
        </button>
      </div>

      {/* SKU */}
      <div className="text-sm font-mono font-medium mb-1">
        SKU {a.sku}
      </div>

      {/* Tipo + Loja */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs font-medium flex items-center gap-1">
          <span>{icone}</span>
          {tipoLabel}
        </span>
        {a.loja ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-current/10">
            {a.loja}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-current/5 text-gray-500">
            Todas as lojas
          </span>
        )}
      </div>

      {/* Antes → Depois */}
      {(a.valor_antes || a.valor_depois) && (
        <div className="text-xs mb-2">
          <span className="text-gray-500 dark:text-gray-400">Antes: </span>
          <span className="font-mono">{a.valor_antes ?? '—'}</span>
          <span className="text-gray-500 dark:text-gray-400 mx-1.5">→</span>
          <span className="text-gray-500 dark:text-gray-400">Depois: </span>
          <span className="font-mono">{a.valor_depois ?? '—'}</span>
        </div>
      )}

      {/* Motivo */}
      {a.motivo && (
        <div className="text-xs mb-1">
          <span className="text-gray-500 dark:text-gray-400">Motivo: </span>
          {a.motivo}
        </div>
      )}

      {/* Observação */}
      {a.observacao && (
        <div className="text-xs mb-2 text-gray-600 dark:text-gray-300">
          <span className="text-gray-500 dark:text-gray-400">Obs: </span>
          {a.observacao}
        </div>
      )}

      {/* Impacto + Responsável */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {a.impacto_esperado && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${IMPACTO_STYLES[a.impacto_esperado]}`}>
            {IMPACTO_LABEL[a.impacto_esperado]}
          </span>
        )}
        {a.responsavel && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400 ml-auto">
            {a.responsavel}
          </span>
        )}
      </div>

      {/* Tags */}
      {a.tags && a.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {a.tags.map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#378ADD]/10 text-[#378ADD]">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
