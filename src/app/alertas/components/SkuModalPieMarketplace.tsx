'use client';

import type { MarketplaceSlice } from '../hooks/useSkuModal';
import { formatBRL } from '@/app/dashboard/lib/date-utils';

interface Props {
  dados: MarketplaceSlice[];
  loading: boolean;
}

const CORES: Record<string, string> = {
  'Mercado Livre': '#F0997B',
  'Shopee':        '#D85A30',
  'TikTok':        '#85B7EB',
  'Shein':         '#AFA9EC',
  'Outro':         '#888780',
};

// Donut SVG puro — sem lib adicional
function Donut({ slices, size = 160, thickness = 28 }: { slices: MarketplaceSlice[]; size?: number; thickness?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circunf = 2 * Math.PI * r;

  let acc = 0;
  const total = slices.reduce((s, x) => s + x.faturamento, 0);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total > 0 && slices.map(s => {
        const frac = s.faturamento / total;
        const len = frac * circunf;
        const offset = acc;
        acc += len;
        return (
          <circle
            key={s.marketplace}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={CORES[s.marketplace] ?? CORES.Outro}
            strokeWidth={thickness}
            strokeDasharray={`${len} ${circunf - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
      })}
    </svg>
  );
}

export function SkuModalPieMarketplace({ dados, loading }: Props) {
  if (loading) {
    return (
      <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5">
        <h3 className="text-xs font-medium opacity-70 mb-3">POR MARKETPLACE</h3>
        <div className="h-48 bg-current/5 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="rounded-lg p-4 bg-black/[0.03] dark:bg-white/[0.03] border border-current/5">
      <h3 className="text-xs font-medium opacity-70 mb-3">POR MARKETPLACE</h3>
      {dados.length === 0 ? (
        <p className="text-xs text-gray-500 py-8 text-center">Sem dados</p>
      ) : (
        <div className="flex items-center gap-4">
          <Donut slices={dados} />
          <div className="flex-1 space-y-1.5">
            {dados.map(s => (
              <div key={s.marketplace} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: CORES[s.marketplace] ?? CORES.Outro }}
                />
                <span className="flex-1 truncate">{s.marketplace}</span>
                <span className="font-medium">{s.percentual.toFixed(1)}%</span>
                <span className="text-[10px] text-gray-500 dark:text-gray-400 w-16 text-right">
                  {formatBRL(s.faturamento)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
