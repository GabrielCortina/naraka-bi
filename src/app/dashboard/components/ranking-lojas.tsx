'use client';

import { useState, useEffect, useMemo } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { LojaRanking } from '../types';
import { formatBRL, formatNumero } from '../lib/date-utils';
import { MarketplaceLogo } from './marketplace-logos';

interface Props {
  data: LojaRanking[];
  loading: boolean;
  // Incrementado quando loja_config é editada ou no auto-refresh.
  // Sem esta dep, a config carregada no mount ficava stale.
  refreshKey?: number;
}

interface LojaConfigEntry {
  ecommerce_nome_tiny: string;
  nome_exibicao: string;
  nome_loja: string | null;
  marketplace: string;
}

export function RankingLojas({ data, loading, refreshKey }: Props) {
  const [configs, setConfigs] = useState<LojaConfigEntry[]>([]);

  useEffect(() => {
    async function loadConfig() {
      const db = createBrowserClient();
      const { data: result } = await db.from('loja_config')
        .select('ecommerce_nome_tiny, nome_exibicao, nome_loja, marketplace');
      if (result) setConfigs(result);
    }
    loadConfig();
  }, [refreshKey]);

  // Mapa: ecommerce_nome → { nome_loja, marketplace }
  const configMap = useMemo(() => {
    const map = new Map<string, { nomeLoja: string; marketplace: string }>();
    for (const c of configs) {
      const nomeLoja = c.nome_loja || c.nome_exibicao;
      map.set(c.ecommerce_nome_tiny, { nomeLoja, marketplace: c.marketplace });
      map.set(c.nome_exibicao, { nomeLoja, marketplace: c.marketplace });
    }
    return map;
  }, [configs]);

  // Agrupa por nome_loja
  const agrupado = useMemo(() => {
    const mapa = new Map<string, { faturamento: number; pecas: number; pedidos: number; marketplace: string }>();

    for (const l of data) {
      const config = configMap.get(l.loja);
      const nomeLoja = config?.nomeLoja || l.loja;
      const marketplace = config?.marketplace || '';

      const entry = mapa.get(nomeLoja) || { faturamento: 0, pecas: 0, pedidos: 0, marketplace };
      entry.faturamento += l.faturamento;
      entry.pecas += l.pecas;
      entry.pedidos += l.pedidos;
      // Mantém o marketplace da primeira entrada encontrada
      if (!entry.marketplace && marketplace) entry.marketplace = marketplace;
      mapa.set(nomeLoja, entry);
    }

    return Array.from(mapa.entries())
      .map(([loja, v]) => ({ loja, ...v }))
      .sort((a, b) => b.faturamento - a.faturamento);
  }, [data, configMap]);

  if (loading) {
    return <div className="card p-4 rounded-lg animate-pulse"><div className="h-[120px] bg-current/5 rounded" /></div>;
  }

  const maxFat = agrupado.length > 0 ? agrupado[0].faturamento : 0;

  return (
    <div className="card p-4 rounded-lg">
      <h3 className="text-xs font-medium mb-3 opacity-70">Ranking de lojas</h3>
      <table className="w-full text-xs">
        <thead><tr className="text-left opacity-50">
          <th className="pb-2">Loja</th><th className="pb-2 text-right">Faturamento</th>
          <th className="pb-2 text-right">Peças</th><th className="pb-2 text-right">Pedidos</th>
        </tr></thead>
        <tbody>
          {agrupado.map(l => (
            <tr key={l.loja} className="border-t border-current/5">
              <td className="py-1.5">
                <div className="flex items-center" style={{ gap: 6 }}>
                  <MarketplaceLogo marketplace={l.marketplace} />
                  <span>{l.loja}</span>
                  {!l.marketplace && (
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
