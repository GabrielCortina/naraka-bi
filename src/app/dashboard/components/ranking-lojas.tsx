'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { LojaRanking } from '../types';
import { formatBRL, formatNumero } from '../lib/date-utils';
import { MarketplaceLogo } from './marketplace-logos';

interface Props {
  data: LojaRanking[];
  loading: boolean;
}

interface LojaConfigMap {
  [ecommerceNome: string]: { marketplace: string; nome_exibicao: string };
}

export function RankingLojas({ data, loading }: Props) {
  const [configMap, setConfigMap] = useState<LojaConfigMap>({});

  useEffect(() => {
    async function loadConfig() {
      const db = createBrowserClient();
      const { data: configs } = await db.from('loja_config').select('ecommerce_nome_tiny, marketplace, nome_exibicao');
      if (configs) {
        const map: LojaConfigMap = {};
        for (const c of configs) {
          map[c.ecommerce_nome_tiny] = { marketplace: c.marketplace, nome_exibicao: c.nome_exibicao };
          // Também mapeia por nome_exibicao (caso a loja no ranking já venha com esse nome)
          map[c.nome_exibicao] = { marketplace: c.marketplace, nome_exibicao: c.nome_exibicao };
        }
        setConfigMap(map);
      }
    }
    loadConfig();
  }, []);

  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[120px] bg-current/5 rounded" /></div>;
  }

  const maxFat = data.length > 0 ? data[0].faturamento : 0;

  function getMarketplace(lojaName: string): string {
    return configMap[lojaName]?.marketplace || '';
  }

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Ranking de lojas</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-left opacity-50">
          <th className="pb-2">Loja</th><th className="pb-2 text-right">Faturamento</th>
          <th className="pb-2 text-right">Peças</th><th className="pb-2 text-right">Pedidos</th>
        </tr></thead>
        <tbody>
          {data.map(l => {
            const mp = getMarketplace(l.loja);
            return (
              <tr key={l.loja} className="border-t border-current/5">
                <td className="py-1.5">
                  <div className="flex items-center" style={{ gap: 6 }}>
                    <MarketplaceLogo marketplace={mp} />
                    <span>{l.loja}</span>
                    {!mp && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-[#EF9F27]/20 text-[#EF9F27]">
                        Não configurada
                      </span>
                    )}
                  </div>
                </td>
                <td className={`py-1.5 text-right font-medium ${l.faturamento === maxFat ? 'text-[#1D9E75]' : ''}`}>
                  {formatBRL(l.faturamento)}
                </td>
                <td className="py-1.5 text-right">{formatNumero(l.pecas)}</td>
                <td className="py-1.5 text-right">{formatNumero(l.pedidos)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
