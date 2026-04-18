'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

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

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function ShopeeConfigContent() {
  const searchParams = useSearchParams();
  const successFlag = searchParams.get('success');
  const errorFlag = searchParams.get('error');

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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Integração Shopee</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Conecte lojas Shopee ao NARAKA-BI via OAuth e teste a conexão com os tokens salvos.
        </p>
      </div>

      {successFlag === 'true' && (
        <div className="rounded border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300 text-sm px-4 py-3">
          Loja conectada com sucesso.
        </div>
      )}
      {errorFlag && (
        <div className="rounded border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-sm px-4 py-3">
          Erro na autorização: {decodeURIComponent(errorFlag)}
        </div>
      )}

      <div>
        <a
          href="/api/auth/shopee"
          className="inline-block px-4 py-2 rounded bg-foreground text-background font-medium text-sm hover:opacity-90 transition"
        >
          Conectar Loja Shopee
        </a>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Lojas conectadas</h2>

        {loading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {loadError && (
          <p className="text-sm text-red-600 dark:text-red-400">Erro: {loadError}</p>
        )}

        {!loading && !loadError && shops.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma loja conectada ainda. Clique em &ldquo;Conectar Loja Shopee&rdquo; para começar.
          </p>
        )}

        {shops.map(shop => {
          const tokenExpired = isExpired(shop.token_expires_at);
          const refreshExpired = isExpired(shop.refresh_expires_at);
          const result = testResults[shop.shop_id] ?? { kind: 'idle' as const };

          return (
            <div
              key={shop.shop_id}
              className="rounded border border-border bg-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium text-foreground">
                    {shop.shop_name || <span className="text-muted-foreground italic">sem nome</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    shop_id: {shop.shop_id}
                  </div>
                </div>
                <div className="text-right text-xs space-y-0.5">
                  <div>
                    Access token:{' '}
                    <span className={tokenExpired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-green-700 dark:text-green-400'}>
                      {tokenExpired ? 'EXPIRADO' : 'ativo'}
                    </span>{' '}
                    <span className="text-muted-foreground">(exp. {fmtDate(shop.token_expires_at)})</span>
                  </div>
                  <div className="text-muted-foreground">
                    Refresh token exp.: {fmtDate(shop.refresh_expires_at)}
                    {refreshExpired && <span className="text-red-600 dark:text-red-400 ml-1 font-medium">(EXPIRADO)</span>}
                  </div>
                  <div className="text-muted-foreground">
                    Último update: {fmtDate(shop.updated_at)}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => testConnection(shop.shop_id)}
                  disabled={result.kind === 'loading'}
                  className="px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-muted transition disabled:opacity-50"
                >
                  {result.kind === 'loading' ? 'Testando…' : 'Testar Conexão'}
                </button>
                <button
                  onClick={() => refreshToken(shop.shop_id)}
                  disabled={refreshingId === shop.shop_id}
                  className="px-3 py-1.5 rounded text-xs border border-border bg-background hover:bg-muted transition disabled:opacity-50"
                >
                  {refreshingId === shop.shop_id ? 'Renovando…' : 'Renovar Token'}
                </button>
              </div>

              {result.kind === 'error' && (
                <div className="rounded border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300 text-xs p-3">
                  <div className="font-medium mb-1">Falha no teste:</div>
                  <div className="break-words">{result.message}</div>
                </div>
              )}
              {result.kind === 'success' && (
                <div className="rounded border border-green-500/30 bg-green-500/10 p-3">
                  <div className="font-medium text-xs text-green-700 dark:text-green-300 mb-1">
                    Conexão OK — get_shop_info:
                  </div>
                  <pre className="text-[11px] text-foreground overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

export default function ShopeeConfigPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Carregando…</div>}>
      <ShopeeConfigContent />
    </Suspense>
  );
}
