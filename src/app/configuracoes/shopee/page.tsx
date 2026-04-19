'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

// Valores fixos do app Shopee (Partner Portal). Referência: SHOPEE_API_REFERENCE.md §1.
const APP_INFO = {
  partnerId: '2033268',
  category: 'Seller In House System',
  environment: 'Produção' as 'Sandbox' | 'Produção',
  goLiveStatus: 'Aprovado ✅',
  redirectUrl: 'https://naraka-bi.vercel.app/api/auth/shopee/callback',
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const BANNER_TTL_MS = 5000;

interface ShopeeShop {
  shop_id: number;
  shop_name: string | null;
  token_expires_at: string;
  refresh_expires_at: string;
  is_active: boolean;
  updated_at: string;
  created_at: string;
}

type TestResult =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: unknown }
  | { kind: 'error'; message: string };

type TokenStatus = 'ok' | 'expiring' | 'expired';

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function tokenStatus(expiresAt: string): TokenStatus {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  if (diff < ONE_HOUR_MS) return 'expiring';
  return 'ok';
}

const STATUS_STYLE: Record<TokenStatus, { dot: string; bg: string; text: string; label: string }> = {
  ok:       { dot: '#1D9E75', bg: 'rgba(29,158,117,0.12)', text: '#1D9E75', label: '🟢 Ativo' },
  expiring: { dot: '#EF9F27', bg: 'rgba(239,159,39,0.14)', text: '#EF9F27', label: '🟡 Expirando' },
  expired:  { dot: '#E24B4A', bg: 'rgba(226,75,74,0.12)', text: '#E24B4A', label: '🔴 Expirado' },
};

function StatusBadge({ status }: { status: TokenStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

function Banner({ type, message, onDismiss }: {
  type: 'success' | 'error';
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, BANNER_TTL_MS);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const color = type === 'success' ? '#1D9E75' : '#E24B4A';
  const bg = type === 'success' ? 'rgba(29,158,117,0.10)' : 'rgba(226,75,74,0.10)';
  return (
    <div
      className="rounded-md px-4 py-2.5 text-xs mb-4 flex items-center justify-between gap-3"
      style={{ background: bg, color, border: `1px solid ${color}30` }}
    >
      <span>{message}</span>
      <button onClick={onDismiss} className="text-sm opacity-60 hover:opacity-100">×</button>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="opacity-60">{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </div>
  );
}

function ShopCard({
  shop, result, refreshing, onTest, onRefresh,
}: {
  shop: ShopeeShop;
  result: TestResult;
  refreshing: boolean;
  onTest: () => void;
  onRefresh: () => void;
}) {
  const status = tokenStatus(shop.token_expires_at);

  return (
    <div className="card p-4 rounded-lg">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">
            {shop.shop_name || `Shop ${shop.shop_id}`}
          </h3>
          <p className="text-[11px] opacity-50 mt-0.5 font-mono">
            shop_id: {shop.shop_id}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-50 mb-0.5">Token expira</div>
          <div className="text-xs">{fmtDateTime(shop.token_expires_at)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-50 mb-0.5">Refresh expira</div>
          <div className="text-xs">{fmtDate(shop.refresh_expires_at)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-50 mb-0.5">Último update</div>
          <div className="text-xs">{fmtDateTime(shop.updated_at)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onTest}
          disabled={result.kind === 'loading'}
          className="px-3 py-1.5 text-xs rounded-md bg-[#378ADD] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {result.kind === 'loading' ? 'Testando…' : 'Testar Conexão'}
        </button>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="px-3 py-1.5 text-xs rounded-md border border-current/10 hover:border-current/30 transition-colors disabled:opacity-50"
        >
          {refreshing ? 'Renovando…' : 'Renovar Token'}
        </button>
      </div>

      {result.kind === 'error' && (
        <div
          className="mt-3 rounded-md p-3 text-[11px]"
          style={{ background: 'rgba(226,75,74,0.08)', color: '#E24B4A', border: '1px solid rgba(226,75,74,0.2)' }}
        >
          <div className="font-semibold mb-1">Falha no teste</div>
          <div className="break-words opacity-90">{result.message}</div>
        </div>
      )}
      {result.kind === 'success' && (
        <div
          className="mt-3 rounded-md p-3"
          style={{ background: 'rgba(29,158,117,0.08)', border: '1px solid rgba(29,158,117,0.2)' }}
        >
          <div className="font-semibold text-[11px] mb-2" style={{ color: '#1D9E75' }}>
            ✓ Conexão OK — get_shop_info
          </div>
          <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap opacity-80 leading-relaxed">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function ShopeeConfigContent() {
  const searchParams = useSearchParams();
  const [successFlag, setSuccessFlag] = useState<boolean>(searchParams.get('success') === 'true');
  const [errorFlag, setErrorFlag] = useState<string | null>(searchParams.get('error'));

  const [shops, setShops] = useState<ShopeeShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<number, TestResult>>({});
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const fetchShops = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/shopee/shops', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Falha ao listar lojas');
      setShops(json.shops ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchShops(); }, [fetchShops]);

  const testConnection = async (shopId: number) => {
    setTestResults(prev => ({ ...prev, [shopId]: { kind: 'loading' } }));
    try {
      const res = await fetch(`/api/shopee/test?shop_id=${shopId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || json.success === false) {
        setTestResults(prev => ({
          ...prev,
          [shopId]: { kind: 'error', message: json?.error || 'Falha no teste' },
        }));
        return;
      }
      setTestResults(prev => ({ ...prev, [shopId]: { kind: 'success', data: json.shop_info } }));
    } catch (err) {
      setTestResults(prev => ({
        ...prev,
        [shopId]: { kind: 'error', message: err instanceof Error ? err.message : 'Erro' },
      }));
    }
  };

  const refreshToken = async (shopId: number) => {
    setRefreshingId(shopId);
    try {
      const res = await fetch('/api/auth/shopee/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Falha ao renovar token');
      await fetchShops();
    } catch (err) {
      alert(`Erro ao renovar: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setRefreshingId(null);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Integrações Shopee</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Gerencie conexões OAuth das lojas Shopee
        </p>
      </div>

      {successFlag && (
        <Banner
          type="success"
          message="Loja conectada com sucesso!"
          onDismiss={() => setSuccessFlag(false)}
        />
      )}
      {errorFlag && (
        <Banner
          type="error"
          message={`Erro na autorização: ${decodeURIComponent(errorFlag)}`}
          onDismiss={() => setErrorFlag(null)}
        />
      )}

      {/* Seção 1 — Conectar Nova Loja */}
      <a
        href="/api/auth/shopee"
        className="block w-full rounded-lg p-8 border-2 border-dashed border-current/15 hover:border-[#378ADD] bg-white dark:bg-[#1a1d27] transition-colors mb-6 group"
      >
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl opacity-40 group-hover:opacity-70 group-hover:text-[#378ADD] transition"
               style={{ border: '1.5px dashed currentColor' }}>
            +
          </div>
          <div className="font-medium text-sm">Conectar Loja Shopee</div>
          <div className="text-xs opacity-50">
            Autorize uma loja Shopee para sincronizar dados financeiros
          </div>
        </div>
      </a>

      {/* Seção 2 — Lojas Conectadas */}
      <div className="mb-6">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3 px-1">
          Lojas Conectadas {!loading && shops.length > 0 && <span className="opacity-50">({shops.length})</span>}
        </h2>

        {loading && (
          <div className="card p-6 rounded-lg text-xs opacity-50">Carregando lojas…</div>
        )}
        {loadError && (
          <div className="card p-6 rounded-lg text-xs" style={{ color: '#E24B4A' }}>
            Erro ao carregar: {loadError}
          </div>
        )}
        {!loading && !loadError && shops.length === 0 && (
          <div className="card p-6 rounded-lg text-xs opacity-60 text-center">
            Nenhuma loja conectada. Clique acima para começar.
          </div>
        )}

        <div className="space-y-3">
          {shops.map(shop => (
            <ShopCard
              key={shop.shop_id}
              shop={shop}
              result={testResults[shop.shop_id] ?? { kind: 'idle' }}
              refreshing={refreshingId === shop.shop_id}
              onTest={() => testConnection(shop.shop_id)}
              onRefresh={() => refreshToken(shop.shop_id)}
            />
          ))}
        </div>
      </div>

      {/* Seção 3 — Informações do App */}
      <div className="card-secondary p-4 rounded-lg">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3">
          Informações do App
        </h2>
        <div className="divide-y divide-current/5">
          <InfoRow label="Partner ID" value={APP_INFO.partnerId} mono />
          <InfoRow label="Categoria" value={APP_INFO.category} />
          <InfoRow label="Ambiente" value={APP_INFO.environment} />
          <InfoRow label="Status Go Live" value={APP_INFO.goLiveStatus} />
          <InfoRow label="Redirect URL" value={APP_INFO.redirectUrl} mono />
        </div>
      </div>
    </div>
  );
}

export default function ShopeeConfigPage() {
  return (
    <Suspense fallback={
      <div className="max-w-[1200px] mx-auto p-4 md:p-6 text-xs opacity-50">
        Carregando…
      </div>
    }>
      <ShopeeConfigContent />
    </Suspense>
  );
}
