'use client';

interface Props {
  lastUpdated: Date | null;
  onNovaAlteracao: () => void;
}

function formatHora(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function AlteracoesHeader({ lastUpdated, onNovaAlteracao }: Props) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Alterações</span>
        </h1>
        <p className="text-xs mt-0.5 text-gray-400 dark:text-gray-500">
          {lastUpdated
            ? <>Atualizado às {formatHora(lastUpdated)}</>
            : 'Carregando...'
          }
        </p>
      </div>

      <button
        onClick={onNovaAlteracao}
        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-[#378ADD] text-white hover:brightness-110 transition-colors"
      >
        <PlusIcon />
        Nova Alteração
      </button>
    </div>
  );
}
