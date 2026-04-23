'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface CustoRow {
  id: number;
  sku_pai: string;
  faixa: string;
  tamanhos: string[];
  custo_unitario: number;
  vigencia_inicio: string;
  vigencia_fim: string | null;
  observacao: string | null;
}

interface SemCustoRow {
  sku_pai: string;
  qtd_vendida_30d: number;
  faturamento_30d: number;
}

interface ApiResponse {
  custos: CustoRow[];
  sem_custo: SemCustoRow[];
}

type Faixa = 'regular' | 'plus' | 'unico';

interface FormState {
  id: number | null;
  sku_pai: string;
  faixa: Faixa;
  tamanhos: string[];
  custo_unitario: string;
  vigencia_inicio: string;
  observacao: string;
}

const FAIXA_OPTIONS: Array<{ value: Faixa; label: string }> = [
  { value: 'unico',   label: 'Único (mesmo custo p/ todos tamanhos)' },
  { value: 'regular', label: 'Regular (PP, P, M, G, GG)' },
  { value: 'plus',    label: 'Plus (G1, G2, G3, G4)' },
];

const TAMANHOS_DISPONIVEIS = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'EG', 'EGG'];
const TAMANHOS_REGULAR_DEFAULT = ['PP', 'P', 'M', 'G', 'GG'];
const TAMANHOS_PLUS_DEFAULT    = ['G1', 'G2', 'G3', 'G4'];

const FAIXA_BADGE: Record<Faixa, { bg: string; color: string; label: string }> = {
  regular: { bg: 'rgba(55,138,221,0.12)',  color: '#1F5FA5', label: 'Regular' },
  plus:    { bg: 'rgba(139,92,246,0.14)',  color: '#6D28D9', label: 'Plus' },
  unico:   { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Único' },
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number): string { return BRL.format(n); }
function fmtInt(n: number): string { return n.toLocaleString('pt-BR'); }
function fmtDateBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(skuPai = ''): FormState {
  return {
    id: null,
    sku_pai: skuPai,
    faixa: 'unico',
    tamanhos: [],
    custo_unitario: '',
    vigencia_inicio: todayStr(),
    observacao: '',
  };
}

function rowToForm(r: CustoRow): FormState {
  return {
    id: r.id,
    sku_pai: r.sku_pai,
    faixa: (r.faixa as Faixa) ?? 'unico',
    tamanhos: r.tamanhos ?? [],
    custo_unitario: String(r.custo_unitario),
    vigencia_inicio: r.vigencia_inicio,
    observacao: r.observacao ?? '',
  };
}

export function CustosSection() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/configuracoes/custos', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as ApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const custosOrdenados = useMemo(() => {
    if (!data) return [];
    return [...data.custos].sort((a, b) => {
      if (a.sku_pai !== b.sku_pai) return a.sku_pai.localeCompare(b.sku_pai);
      if (a.faixa !== b.faixa) return a.faixa.localeCompare(b.faixa);
      return b.vigencia_inicio.localeCompare(a.vigencia_inicio);
    });
  }, [data]);

  function openNew(skuPai = '') {
    setEditing(emptyForm(skuPai));
  }

  function openEdit(r: CustoRow) {
    setEditing(rowToForm(r));
  }

  function close() {
    setEditing(null);
    setSaving(false);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (!editing) return;
    setEditing({ ...editing, [key]: value });
  }

  function onChangeFaixa(next: Faixa) {
    if (!editing) return;
    let tamanhos = editing.tamanhos;
    if (next === 'unico') tamanhos = [];
    else if (next === 'regular' && tamanhos.length === 0) tamanhos = TAMANHOS_REGULAR_DEFAULT;
    else if (next === 'plus' && tamanhos.length === 0) tamanhos = TAMANHOS_PLUS_DEFAULT;
    setEditing({ ...editing, faixa: next, tamanhos });
  }

  function toggleTamanho(tam: string) {
    if (!editing) return;
    const has = editing.tamanhos.includes(tam);
    const next = has ? editing.tamanhos.filter(t => t !== tam) : [...editing.tamanhos, tam];
    setEditing({ ...editing, tamanhos: next });
  }

  async function save() {
    if (!editing) return;
    if (!editing.sku_pai.trim()) {
      setBanner({ type: 'error', message: 'SKU pai é obrigatório' });
      return;
    }
    const custo = Number(editing.custo_unitario.replace(',', '.'));
    if (!Number.isFinite(custo) || custo <= 0) {
      setBanner({ type: 'error', message: 'Custo unitário deve ser > 0' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/configuracoes/custos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          sku_pai: editing.sku_pai.trim(),
          faixa: editing.faixa,
          tamanhos: editing.faixa === 'unico' ? [] : editing.tamanhos,
          custo_unitario: custo,
          vigencia_inicio: editing.vigencia_inicio,
          observacao: editing.observacao.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBanner({ type: 'success', message: 'Custo salvo com sucesso' });
      close();
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao salvar' });
      setSaving(false);
    }
  }

  async function remove(r: CustoRow) {
    const label = `${r.sku_pai} (${r.faixa})`;
    if (!confirm(`Remover custo de "${label}"? O CMV desse SKU voltará a ser R$ 0 no cálculo de lucro.`)) return;
    setDeleting(r.id);
    try {
      const res = await fetch('/api/configuracoes/custos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: r.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBanner({ type: 'success', message: `Custo de "${label}" removido` });
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao remover' });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mt-8">
      {banner && (
        <div
          className="rounded-md px-4 py-2.5 text-xs mb-4 flex items-center justify-between gap-3"
          style={
            banner.type === 'success'
              ? { background: 'rgba(29,158,117,0.10)', color: '#1D9E75', border: '1px solid rgba(29,158,117,0.3)' }
              : { background: 'rgba(226,75,74,0.10)', color: '#E24B4A', border: '1px solid rgba(226,75,74,0.3)' }
          }
        >
          <span>{banner.message}</span>
          <button onClick={() => setBanner(null)} className="text-sm opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      {error && !loading && (
        <div className="card p-4 rounded-lg text-xs mb-4" style={{ color: '#E24B4A' }}>
          Erro ao carregar custos: {error}
        </div>
      )}

      {/* =================== SKUs sem custo =================== */}
      <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3 px-1">
        SKUs sem custo cadastrado
      </h2>

      {loading ? (
        <div className="card p-6 rounded-lg text-xs opacity-50 mb-6">Carregando…</div>
      ) : !data || data.sem_custo.length === 0 ? (
        <div
          className="card p-4 rounded-lg mb-6 text-xs flex items-center gap-2"
          style={{ color: '#1D9E75' }}
        >
          <span>✓</span>
          <span>Todos os SKUs com vendas recentes têm custo cadastrado</span>
        </div>
      ) : (
        <>
          <div
            className="rounded-md px-4 py-2.5 text-xs mb-3"
            style={{ background: 'rgba(239,159,39,0.12)', color: '#8B5F0A', border: '1px solid rgba(239,159,39,0.3)' }}
          >
            <strong>{data.sem_custo.length}</strong>{' '}
            {data.sem_custo.length === 1 ? 'SKU ativo sem custo' : 'SKUs ativos sem custo'} cadastrado.
            Configure abaixo para cálculo correto de lucro.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {data.sem_custo.map(u => (
              <div key={u.sku_pai} className="card p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#378ADD]/15 text-[#378ADD]">
                    SKU {u.sku_pai}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] opacity-70">
                  <span>{fmtInt(u.qtd_vendida_30d)} vendas (30d)</span>
                </div>
                <div className="text-xs font-medium">
                  {fmtBRL(u.faturamento_30d)}
                </div>
                <button
                  onClick={() => openNew(u.sku_pai)}
                  className="mt-1 px-3 py-1.5 text-xs rounded-md bg-[#378ADD] text-white hover:opacity-90 transition-opacity"
                >
                  Cadastrar custo
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* =================== Custos cadastrados =================== */}
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60">
          Custos cadastrados{' '}
          {!loading && data && (
            <span className="opacity-50">({data.custos.length})</span>
          )}
        </h2>
        <button
          onClick={() => openNew()}
          className="text-[11px] text-[#378ADD] hover:underline"
        >
          + Adicionar custo
        </button>
      </div>

      {loading ? (
        <div className="card p-6 rounded-lg text-xs opacity-50 mb-6">Carregando…</div>
      ) : !data || data.custos.length === 0 ? (
        <div className="card p-6 rounded-lg text-xs opacity-60 mb-6 text-center">
          Nenhum custo cadastrado ainda.
        </div>
      ) : (
        <div className="card rounded-lg mb-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50 border-b border-current/10">
                  <th className="px-3 py-2 font-medium">SKU Pai</th>
                  <th className="px-3 py-2 font-medium">Faixa</th>
                  <th className="px-3 py-2 font-medium">Tamanhos</th>
                  <th className="px-3 py-2 font-medium text-right">Custo unitário</th>
                  <th className="px-3 py-2 font-medium">Vigência</th>
                  <th className="px-3 py-2 font-medium">Observação</th>
                  <th className="px-3 py-2 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {custosOrdenados.map(r => {
                  const faixa = (r.faixa as Faixa) ?? 'unico';
                  const badge = FAIXA_BADGE[faixa] ?? FAIXA_BADGE.unico;
                  const vigencia = r.vigencia_fim
                    ? `${fmtDateBR(r.vigencia_inicio)} a ${fmtDateBR(r.vigencia_fim)}`
                    : `Desde ${fmtDateBR(r.vigencia_inicio)}`;
                  return (
                    <tr key={r.id} className="border-t border-current/5">
                      <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                        {r.sku_pai}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ background: badge.bg, color: badge.color }}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {r.tamanhos.length === 0 ? (
                          <span className="text-[11px] opacity-40">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {r.tamanhos.map(t => (
                              <span
                                key={t}
                                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-current/10"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {fmtBRL(Number(r.custo_unitario))}
                      </td>
                      <td className="px-3 py-2 text-[11px] whitespace-nowrap opacity-80">
                        {vigencia}
                      </td>
                      <td className="px-3 py-2 max-w-[200px] truncate opacity-70" title={r.observacao ?? ''}>
                        {r.observacao || <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-[11px] text-[#378ADD] hover:underline mr-3"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remove(r)}
                          disabled={deleting === r.id}
                          className="text-[11px] hover:underline disabled:opacity-50"
                          style={{ color: '#E24B4A' }}
                        >
                          {deleting === r.id ? 'Removendo…' : 'Excluir'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================== Como funciona =================== */}
      <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3 px-1">
        Como funciona
      </h2>

      <div className="card-secondary p-4 rounded-lg text-xs leading-relaxed opacity-80">
        <p>
          O custo de mercadoria (CMV) é usado para calcular o lucro real de cada pedido
          na aba <strong>Lucro e Prejuízo</strong>.
        </p>
        <ul className="mt-2 space-y-1.5 pl-4 list-disc">
          <li><strong>SKU pai:</strong> identificador numérico do produto (ex: <code className="font-mono text-[11px] px-1">90909</code>).</li>
          <li><strong>Faixa:</strong> diferencie custos entre tamanhos regulares e plus size. Use <em>Único</em> quando o custo é o mesmo para todos.</li>
          <li><strong>Tamanhos:</strong> quais tamanhos pertencem a essa faixa. Ignorado quando faixa é <em>Único</em>.</li>
          <li><strong>Vigência:</strong> a partir de quando esse custo vale — útil quando o preço de compra muda. Ao cadastrar um custo novo, o anterior é fechado automaticamente.</li>
        </ul>
        <p className="mt-2">
          SKUs sem custo cadastrado são calculados com <strong>CMV = R$ 0</strong> (nunca bloqueiam o cálculo).
        </p>
      </div>

      {/* =================== Modal =================== */}
      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 overflow-hidden p-4"
          onClick={close}
        >
          <div
            className="card rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 pb-3 border-b border-current/10 shrink-0">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  {editing.id == null ? 'Cadastrar custo' : 'Editar custo'}
                </h3>
                <button onClick={close} className="text-lg opacity-50 hover:opacity-100">×</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-3">
              <Field label="SKU pai" hint="Parte numérica do SKU, ex: 90909">
                <input
                  type="text"
                  value={editing.sku_pai}
                  onChange={e => updateField('sku_pai', e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 90909"
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-current/15 bg-transparent"
                />
              </Field>

              <Field label="Faixa">
                <select
                  value={editing.faixa}
                  onChange={e => onChangeFaixa(e.target.value as Faixa)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                >
                  {FAIXA_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field
                label="Tamanhos"
                hint={editing.faixa === 'unico'
                  ? 'Desabilitado — faixa Único aplica para todos tamanhos'
                  : 'Selecione quais tamanhos pertencem a essa faixa'}
              >
                <div className="flex flex-wrap gap-1.5">
                  {TAMANHOS_DISPONIVEIS.map(t => {
                    const selected = editing.tamanhos.includes(t);
                    const disabled = editing.faixa === 'unico';
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => !disabled && toggleTamanho(t)}
                        disabled={disabled}
                        className="text-[11px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        style={
                          selected && !disabled
                            ? { background: '#378ADD', borderColor: '#378ADD', color: 'white' }
                            : { borderColor: 'rgba(100,100,100,0.25)', background: 'transparent' }
                        }
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Custo unitário (R$)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={editing.custo_unitario}
                  onChange={e => updateField('custo_unitario', e.target.value)}
                  placeholder="Ex: 15.00"
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                />
              </Field>

              <Field label="Vigência início" hint="A partir de quando esse custo vale">
                <input
                  type="date"
                  value={editing.vigencia_inicio}
                  onChange={e => updateField('vigencia_inicio', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                />
              </Field>

              <Field label="Observação">
                <textarea
                  value={editing.observacao}
                  onChange={e => updateField('observacao', e.target.value)}
                  placeholder="Ex: Custo atual do fornecedor X"
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent resize-none"
                />
              </Field>
            </div>

            <div className="p-4 border-t border-current/10 shrink-0 flex items-center justify-end gap-2">
              <button
                onClick={close}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-md border border-current/15 hover:border-current/30 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1.5 text-xs rounded-md bg-[#378ADD] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wider opacity-50 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[10px] opacity-40 mt-1">{hint}</p>}
    </div>
  );
}
