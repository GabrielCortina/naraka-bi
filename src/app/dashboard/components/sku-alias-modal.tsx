'use client';

import { useState, useEffect, useCallback } from 'react';

interface SkuAlias {
  id: number;
  sku_original: string;
  canal: string | null;
  sku_canonico: string;
  ativo: boolean;
  observacao: string | null;
  created_at: string;
}

interface SkuKit {
  id: number;
  sku_kit: string;
  sku_componente: string;
  quantidade: number;
  ativo: boolean;
  created_at: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialTab?: 'alias' | 'kits';
}

const CANAIS = [
  { value: '', label: 'Todos' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'mercado_livre', label: 'Mercado Livre' },
  { value: 'tiktok', label: 'TikTok Shop' },
  { value: 'shein', label: 'Shein' },
];

export function SkuAliasModal({ open, onClose, initialTab = 'alias' }: Props) {
  const [tab, setTab] = useState<'alias' | 'kits'>(initialTab);
  const [aliases, setAliases] = useState<SkuAlias[]>([]);
  const [kits, setKits] = useState<SkuKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  // Form alias
  const [aSkuOrig, setASkuOrig] = useState('');
  const [aCanal, setACanal] = useState('');
  const [aSkuCan, setASkuCan] = useState('');
  const [aObs, setAObs] = useState('');
  const [aSaving, setASaving] = useState(false);

  // Form kit
  const [kSkuKit, setKSkuKit] = useState('');
  const [kSkuComp, setKSkuComp] = useState('');
  const [kQtd, setKQtd] = useState(1);
  const [kSaving, setKSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
  }, [open, initialTab]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rAlias, rKit] = await Promise.all([
        fetch('/api/sku/alias').then(r => r.json()),
        fetch('/api/sku/kit').then(r => r.json()),
      ]);
      setAliases(rAlias.data ?? []);
      setKits(rKit.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadAll();
  }, [open, loadAll]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2000);
  }

  async function handleAddAlias() {
    if (!aSkuOrig.trim() || !aSkuCan.trim()) {
      setError('SKU original e SKU canônico são obrigatórios');
      return;
    }
    setASaving(true);
    setError('');
    try {
      const res = await fetch('/api/sku/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_original: aSkuOrig.trim(),
          canal: aCanal || null,
          sku_canonico: aSkuCan.trim(),
          observacao: aObs.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'erro ao salvar');
      setASkuOrig(''); setACanal(''); setASkuCan(''); setAObs('');
      await loadAll();
      showToast('Alias adicionado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
    } finally {
      setASaving(false);
    }
  }

  async function toggleAlias(id: number, ativo: boolean) {
    try {
      const res = await fetch('/api/sku/alias', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ativo }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || 'erro');
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
    }
  }

  async function handleAddKit() {
    if (!kSkuKit.trim() || !kSkuComp.trim()) {
      setError('SKU kit e SKU componente são obrigatórios');
      return;
    }
    if (kSkuKit.trim() === kSkuComp.trim()) {
      setError('SKU kit e SKU componente devem ser diferentes');
      return;
    }
    setKSaving(true);
    setError('');
    try {
      const res = await fetch('/api/sku/kit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku_kit: kSkuKit.trim(),
          sku_componente: kSkuComp.trim(),
          quantidade: kQtd,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'erro ao salvar');
      setKSkuComp(''); setKQtd(1);
      await loadAll();
      showToast('Componente adicionado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
    } finally {
      setKSaving(false);
    }
  }

  async function toggleKit(id: number, ativo: boolean) {
    try {
      const res = await fetch('/api/sku/kit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ativo }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || 'erro');
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
    }
  }

  if (!open) return null;

  // Agrupa kits por sku_kit
  const kitsAgrupados = kits.reduce<Record<string, SkuKit[]>>((acc, k) => {
    if (!acc[k.sku_kit]) acc[k.sku_kit] = [];
    acc[k.sku_kit].push(k);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden"
      onClick={onClose}
    >
      <div
        className="card rounded-lg max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold">Mapeamento de SKU</h2>
            <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
          </div>
          <p className="text-[10px] opacity-40 mb-4">
            Unifique SKUs duplicados entre marketplaces e explode kits em componentes unitários
          </p>
        </div>

        {/* Tabs */}
        <div
          className="shrink-0 px-6"
          style={{ display: 'flex', gap: 6, paddingBottom: 12, borderBottom: '0.5px solid var(--bord, rgba(128,128,128,0.15))' }}
        >
          {(['alias', 'kits'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                fontSize: 10, padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                border: tab === t ? '0.5px solid #378ADD' : '0.5px solid var(--bord, rgba(128,128,128,0.15))',
                background: tab === t ? '#378ADD' : 'transparent',
                color: tab === t ? 'white' : 'var(--txt2, #9ca3af)',
              }}
            >
              {t === 'alias' ? 'Alias de SKU' : 'Mapeamento de Kits'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0">
          {loading ? (
            <div className="animate-pulse h-40 bg-current/5 rounded" />
          ) : tab === 'alias' ? (
            <div className="space-y-3">
              {/* Form de adição */}
              <div className="card-secondary p-3 rounded-lg">
                <p className="text-[9px] opacity-50 mb-2 uppercase tracking-wider">Adicionar alias</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <input
                    type="text"
                    value={aSkuOrig}
                    onChange={e => setASkuOrig(e.target.value)}
                    placeholder="SKU original"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <select
                    value={aCanal}
                    onChange={e => setACanal(e.target.value)}
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  >
                    {CANAIS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <input
                    type="text"
                    value={aSkuCan}
                    onChange={e => setASkuCan(e.target.value)}
                    placeholder="SKU canônico"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <input
                    type="text"
                    value={aObs}
                    onChange={e => setAObs(e.target.value)}
                    placeholder="Observação"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <button
                    onClick={handleAddAlias}
                    disabled={aSaving}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#378ADD] text-white hover:bg-[#2a6fb5] disabled:opacity-50"
                  >
                    {aSaving ? '...' : 'Adicionar'}
                  </button>
                </div>
              </div>

              {/* Tabela */}
              <table className="w-full text-xs">
                <thead><tr className="text-left opacity-50">
                  <th className="pb-2">SKU Original</th>
                  <th className="pb-2">Canal</th>
                  <th className="pb-2">SKU Canônico</th>
                  <th className="pb-2">Observação</th>
                  <th className="pb-2 text-right">Ativo</th>
                </tr></thead>
                <tbody>
                  {aliases.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center opacity-40">Nenhum alias cadastrado</td></tr>
                  ) : aliases.map(a => (
                    <tr key={a.id} className="border-t border-current/5">
                      <td className="py-1.5 font-mono text-[10px]">{a.sku_original}</td>
                      <td className="py-1.5 opacity-70">{a.canal || '—'}</td>
                      <td className="py-1.5 font-mono text-[10px]">{a.sku_canonico}</td>
                      <td className="py-1.5 opacity-60">{a.observacao || ''}</td>
                      <td className="py-1.5 text-right">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={a.ativo}
                            onChange={e => toggleAlias(a.id, e.target.checked)}
                          />
                          <span className="text-[10px]">{a.ativo ? 'Ativo' : 'Inativo'}</span>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Form de adição */}
              <div className="card-secondary p-3 rounded-lg">
                <p className="text-[9px] opacity-50 mb-2 uppercase tracking-wider">Adicionar componente</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={kSkuKit}
                    onChange={e => setKSkuKit(e.target.value)}
                    placeholder="SKU do kit"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <input
                    type="text"
                    value={kSkuComp}
                    onChange={e => setKSkuComp(e.target.value)}
                    placeholder="SKU componente"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <input
                    type="number"
                    min={1}
                    value={kQtd}
                    onChange={e => setKQtd(Math.max(1, Number(e.target.value) || 1))}
                    placeholder="Qtd"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />
                  <button
                    onClick={handleAddKit}
                    disabled={kSaving}
                    className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#378ADD] text-white hover:bg-[#2a6fb5] disabled:opacity-50"
                  >
                    {kSaving ? '...' : 'Adicionar'}
                  </button>
                </div>
              </div>

              {/* Tabela agrupada por kit */}
              {Object.keys(kitsAgrupados).length === 0 ? (
                <p className="py-4 text-center opacity-40 text-xs">Nenhum kit cadastrado</p>
              ) : Object.entries(kitsAgrupados).map(([kitSku, comps]) => (
                <div key={kitSku} className="card-secondary p-3 rounded-lg">
                  <p className="text-[10px] font-mono opacity-70 mb-2">
                    KIT: <span className="text-[#378ADD]">{kitSku}</span>
                  </p>
                  <table className="w-full text-xs">
                    <thead><tr className="text-left opacity-50">
                      <th className="pb-1">Componente</th>
                      <th className="pb-1 text-right">Quantidade</th>
                      <th className="pb-1 text-right">Ativo</th>
                    </tr></thead>
                    <tbody>
                      {comps.map(c => (
                        <tr key={c.id} className="border-t border-current/5">
                          <td className="py-1.5 font-mono text-[10px]">{c.sku_componente}</td>
                          <td className="py-1.5 text-right">{c.quantidade}</td>
                          <td className="py-1.5 text-right">
                            <label className="inline-flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={c.ativo}
                                onChange={e => toggleKit(c.id, e.target.checked)}
                              />
                              <span className="text-[10px]">{c.ativo ? 'Ativo' : 'Inativo'}</span>
                            </label>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-4 pt-3 shrink-0 border-t border-current/5 flex items-center justify-between">
          <div className="flex-1">
            {error && <span className="text-xs text-red-500">{error}</span>}
            {toast && !error && <span className="text-xs text-[#1D9E75]">{toast}</span>}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-md border border-current/10 hover:bg-current/5"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
