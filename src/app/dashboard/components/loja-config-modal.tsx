'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';

interface LojaConfig {
  ecommerce_nome_tiny: string;
  nome_exibicao: string;
  marketplace: string;
  tipo_ml: string | null;
  ativo: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const MARKETPLACES = [
  { value: 'mercado_livre', label: 'Mercado Livre' },
  { value: 'shopee', label: 'Shopee' },
  { value: 'tiktok', label: 'TikTok Shop' },
  { value: 'shein', label: 'Shein' },
];

export function LojaConfigModal({ open, onClose, onSaved }: Props) {
  const [configs, setConfigs] = useState<LojaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!open) return;
    loadData();
  }, [open]);

  async function loadData() {
    setLoading(true);
    const db = createBrowserClient();

    // Busca nomes distintos de lojas nos pedidos
    const { data: pedidos } = await db.from('pedidos')
      .select('ecommerce_nome')
      .not('ecommerce_nome', 'is', null);

    const nomesUnicos = Array.from(new Set((pedidos || []).map(p => p.ecommerce_nome).filter(Boolean))).sort();

    // Busca configs salvas
    const { data: saved } = await db.from('loja_config').select('*');
    const savedMap = new Map((saved || []).map(s => [s.ecommerce_nome_tiny, s]));

    // Monta lista: config salva ou default
    const lista: LojaConfig[] = nomesUnicos.map(nome => {
      const existing = savedMap.get(nome);
      if (existing) {
        return {
          ecommerce_nome_tiny: existing.ecommerce_nome_tiny,
          nome_exibicao: existing.nome_exibicao,
          marketplace: existing.marketplace,
          tipo_ml: existing.tipo_ml,
          ativo: existing.ativo,
        };
      }
      // Inferir marketplace pelo nome
      const lower = nome.toLowerCase();
      let mp = 'mercado_livre';
      if (lower.includes('shopee')) mp = 'shopee';
      else if (lower.includes('tiktok')) mp = 'tiktok';
      else if (lower.includes('shein')) mp = 'shein';

      return {
        ecommerce_nome_tiny: nome,
        nome_exibicao: nome,
        marketplace: mp,
        tipo_ml: mp === 'mercado_livre' ? (lower.includes('full') ? 'full' : 'coleta') : null,
        ativo: true,
      };
    });

    setConfigs(lista);
    setLoading(false);
  }

  function updateConfig(idx: number, field: keyof LojaConfig, value: string | boolean | null) {
    setConfigs(prev => prev.map((c, i) => {
      if (i !== idx) return c;
      const updated = { ...c, [field]: value };
      // Limpa tipo_ml se marketplace não for mercado_livre
      if (field === 'marketplace' && value !== 'mercado_livre') {
        updated.tipo_ml = null;
      }
      return updated;
    }));
  }

  async function handleSave() {
    setSaving(true);
    const db = createBrowserClient();

    for (const config of configs) {
      await db.from('loja_config').upsert({
        ecommerce_nome_tiny: config.ecommerce_nome_tiny,
        nome_exibicao: config.nome_exibicao,
        marketplace: config.marketplace,
        tipo_ml: config.tipo_ml,
        ativo: config.ativo,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'ecommerce_nome_tiny' });
    }

    setSaving(false);
    setToast('Configurações salvas');
    setTimeout(() => setToast(''), 2000);
    onSaved();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden" onClick={onClose}>
      <div
        className="card rounded-lg max-w-3xl w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header fixo */}
        <div className="p-6 pb-0 shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold">Configurar lojas</h2>
            <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
          </div>
          <p className="text-[10px] opacity-40 mb-4">
            Mapeie cada loja para o marketplace correto e defina o nome de exibição
          </p>
        </div>

        {/* Corpo scrollável */}
        <div className="px-6 overflow-y-auto flex-1 min-h-0">
        {loading ? (
          <div className="animate-pulse h-40 bg-current/5 rounded" />
        ) : (
          <div className="space-y-3">
            {configs.map((config, idx) => (
              <div key={config.ecommerce_nome_tiny} className="card-secondary p-3 rounded-lg">
                <p className="text-[9px] opacity-40 mb-2 font-mono">{config.ecommerce_nome_tiny}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {/* Nome de exibição */}
                  <input
                    type="text"
                    value={config.nome_exibicao}
                    onChange={e => updateConfig(idx, 'nome_exibicao', e.target.value)}
                    placeholder="Nome de exibição"
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  />

                  {/* Marketplace */}
                  <select
                    value={config.marketplace}
                    onChange={e => updateConfig(idx, 'marketplace', e.target.value)}
                    className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                  >
                    {MARKETPLACES.map(mp => (
                      <option key={mp.value} value={mp.value}>{mp.label}</option>
                    ))}
                  </select>

                  {/* Tipo ML (condicional) */}
                  {config.marketplace === 'mercado_livre' ? (
                    <select
                      value={config.tipo_ml || ''}
                      onChange={e => updateConfig(idx, 'tipo_ml', e.target.value || null)}
                      className="px-2 py-1.5 text-xs rounded border border-current/10 bg-transparent"
                    >
                      <option value="">Tipo ML</option>
                      <option value="full">Full</option>
                      <option value="coleta">Coleta</option>
                    </select>
                  ) : (
                    <div />
                  )}

                  {/* Toggle ativo */}
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.ativo}
                      onChange={e => updateConfig(idx, 'ativo', e.target.checked)}
                      className="rounded"
                    />
                    {config.ativo ? 'Ativo' : 'Inativo'}
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>

        {/* Rodapé fixo */}
        <div className="p-6 pt-0 shrink-0">
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-current/5">
          {toast && <span className="text-xs text-[#1D9E75]">{toast}</span>}
          <div className="flex-1" />
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium rounded-md bg-[#378ADD] text-white hover:bg-[#2a6fb5] disabled:opacity-50 transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar configurações'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
