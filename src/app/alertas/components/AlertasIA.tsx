'use client';

interface Props {
  texto: string | null;
  loading: boolean;
  geradoEm: Date | null;
  error: string | null;
  onGerar: () => void;
}

function formatHora(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function AlertasIA({ texto, loading, geradoEm, error, onGerar }: Props) {
  return (
    <div className="card p-4 rounded-lg h-fit">
      <h3 className="text-xs font-medium opacity-70 mb-3">🤖 ANÁLISE IA</h3>

      {loading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-current/5 rounded w-full" />
          <div className="h-3 bg-current/5 rounded w-4/5" />
          <div className="h-3 bg-current/5 rounded w-3/5" />
          <div className="h-3 bg-current/5 rounded w-full" />
          <div className="h-3 bg-current/5 rounded w-2/3" />
        </div>
      ) : error ? (
        <div className="card-secondary rounded-md p-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      ) : texto ? (
        <div className="card-secondary rounded-md p-3">
          <div
            className="text-xs leading-relaxed opacity-80 whitespace-pre-wrap"
            style={{ lineHeight: '1.6' }}
          >
            {texto}
          </div>
        </div>
      ) : (
        <div className="card-secondary rounded-md p-3">
          <p className="text-xs opacity-40 text-center">
            Clique em &quot;Gerar análise&quot; para a IA interpretar os alertas atuais.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-current/5">
        {geradoEm && (
          <span className="text-[10px] opacity-40">
            Gerado: {formatHora(geradoEm)}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onGerar}
          disabled={loading}
          className="px-3 py-1.5 text-[10px] font-medium rounded-md border border-current/10 hover:bg-current/5 disabled:opacity-40"
        >
          {loading ? 'Gerando...' : '🔄 Gerar análise'}
        </button>
      </div>
    </div>
  );
}
