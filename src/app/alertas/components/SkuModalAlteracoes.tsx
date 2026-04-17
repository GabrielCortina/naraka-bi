'use client';

import type { AlteracaoItem } from '../hooks/useSkuModal';

interface Props {
  alteracoes: AlteracaoItem[];
  loading: boolean;
}

const CORES_TIPO: Record<string, string> = {
  preco:               '#D85A30',
  imagem_principal:    '#85B7EB',
  imagens_secundarias: '#85B7EB',
  titulo:              '#AFA9EC',
  descricao:           '#AFA9EC',
  ads:                 '#1D9E75',
  estoque:             '#888780',
  frete:               '#888780',
  categoria:           '#888780',
  variacoes:           '#AFA9EC',
  desativacao:         '#E24B4A',
  reativacao:          '#1D9E75',
  outro:               '#888780',
};

const LABELS_TIPO: Record<string, string> = {
  preco: 'Preço',
  imagem_principal: 'Imagem Principal',
  imagens_secundarias: 'Imagens Secundárias',
  titulo: 'Título',
  descricao: 'Descrição',
  ads: 'Ads / Campanha',
  estoque: 'Estoque',
  frete: 'Frete',
  categoria: 'Categoria',
  variacoes: 'Variações',
  desativacao: 'Desativação',
  reativacao: 'Reativação',
  outro: 'Outro',
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function ImpactoBadge({ impacto }: { impacto: number | null }) {
  if (impacto === null || impacto === 0) return null;
  const positivo = impacto > 0;
  const arrow = positivo ? '↗' : '↘';
  const sign = positivo ? '+' : '';
  const bg = positivo ? 'bg-green-500/15' : 'bg-red-500/15';
  const tx = positivo ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300';
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${bg} ${tx}`}>
      {arrow} {sign}{impacto.toFixed(1)}% após
    </span>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[1, 2].map(i => (
        <div key={i} className="h-20 bg-current/5 rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

export function SkuModalAlteracoes({ alteracoes, loading }: Props) {
  return (
    <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5 mt-4">
      <h3 className="text-xs font-medium opacity-70 mb-3">
        ALTERAÇÕES RECENTES {alteracoes.length > 0 && <span className="opacity-70">({alteracoes.length})</span>}
      </h3>
      {loading ? (
        <Skeleton />
      ) : alteracoes.length === 0 ? (
        <p className="text-xs text-gray-500 py-6 text-center">
          Nenhuma alteração registrada para este SKU no período
        </p>
      ) : (
        <div className="space-y-2">
          {alteracoes.map(a => {
            const cor = CORES_TIPO[a.tipoAlteracao] ?? CORES_TIPO.outro;
            const label = LABELS_TIPO[a.tipoAlteracao] ?? a.tipoAlteracao;
            return (
              <div
                key={a.id}
                className="rounded-md p-3 bg-black/[0.03] dark:bg-white/[0.03]"
                style={{ borderLeft: `3px solid ${cor}` }}
              >
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium">{label}</span>
                    <span className="text-gray-500 dark:text-gray-400">{formatDate(a.dataAlteracao)}</span>
                  </div>
                  <ImpactoBadge impacto={a.impactoPercent} />
                </div>
                {(a.valorAntes || a.valorDepois) && (
                  <div className="text-xs mb-1">
                    <span className="font-mono">{a.valorAntes ?? '—'}</span>
                    <span className="text-gray-500 dark:text-gray-400 mx-1.5">→</span>
                    <span className="font-mono">{a.valorDepois ?? '—'}</span>
                  </div>
                )}
                {a.motivo && (
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    <span className="text-gray-500 dark:text-gray-400">Motivo: </span>
                    {a.motivo}
                  </div>
                )}
                {a.observacao && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {a.observacao}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
