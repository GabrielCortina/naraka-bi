'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface MappingRow {
  transaction_type: string;
  classificacao: string;
  kpi_destino: string;
  descricao_pt: string;
  entra_no_custo_total: boolean;
  duplica_com: string | null;
  natureza: string;
  updated_at: string | null;
}

interface UnmappedRow {
  transaction_type: string;
  count: number;
  total: number;
  money_flow: string | null;
  exemplo_descricao: string | null;
}

interface ApiResponse {
  mapeados: MappingRow[];
  nao_mapeados: UnmappedRow[];
}

interface FormState {
  transaction_type: string;
  classificacao: string;
  kpi_destino: string;
  descricao_pt: string;
  entra_no_custo_total: boolean;
  duplica_com: string;
  natureza: string;
}

const CLASSIFICACAO_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'receita',          label: 'Receita' },
  { value: 'custo_plataforma', label: 'Custo — Plataforma' },
  { value: 'custo_aquisicao',  label: 'Custo — Aquisição' },
  { value: 'custo_friccao',    label: 'Custo — Fricção operacional' },
  { value: 'informativo',      label: 'Informativo' },
  { value: 'ignorar',          label: 'Ignorar' },
];

const KPI_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'receita_escrow',    label: 'Receita escrow' },
  { value: 'comissao',          label: 'Comissão' },
  { value: 'taxa',              label: 'Taxa' },
  { value: 'ads',               label: 'Ads' },
  { value: 'afiliados',         label: 'Afiliados' },
  { value: 'difal',             label: 'DIFAL' },
  { value: 'devolucao',         label: 'Devolução' },
  { value: 'devolucao_frete',   label: 'Devolução — frete' },
  { value: 'saque',             label: 'Saque' },
  { value: 'pedidos_negativos', label: 'Pedidos negativos' },
  { value: 'fbs',               label: 'FBS' },
  { value: 'compensacao',       label: 'Compensação' },
  { value: 'outros',            label: 'Outros' },
  { value: 'ignorar',           label: 'Ignorar' },
];

const NATUREZA_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'credito', label: 'Crédito (dinheiro entra)' },
  { value: 'debito',  label: 'Débito (dinheiro sai)' },
  { value: 'neutro',  label: 'Neutro' },
];

const CLASSIFICACAO_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  receita:          { bg: 'rgba(29,158,117,0.12)',  color: '#1D9E75', label: 'Receita' },
  custo_plataforma: { bg: 'rgba(226,75,74,0.12)',   color: '#A32D2D', label: 'Plataforma' },
  custo_aquisicao:  { bg: 'rgba(239,159,39,0.14)',  color: '#8B5F0A', label: 'Aquisição' },
  custo_friccao:    { bg: 'rgba(216,90,48,0.14)',   color: '#8B3910', label: 'Fricção' },
  informativo:      { bg: 'rgba(55,138,221,0.12)',  color: '#1F5FA5', label: 'Informativo' },
  ignorar:          { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Ignorar' },
};

const NATUREZA_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  credito: { bg: 'rgba(29,158,117,0.12)',  color: '#1D9E75', label: 'Crédito' },
  debito:  { bg: 'rgba(226,75,74,0.12)',   color: '#A32D2D', label: 'Débito' },
  neutro:  { bg: 'rgba(156,163,175,0.14)', color: '#4b5563', label: 'Neutro' },
};

// Ordem de exibição — custos primeiro (mais críticos), depois receita,
// informativo e ignorar.
const CLASSIFICACAO_ORDER: Record<string, number> = {
  custo_plataforma: 0,
  custo_aquisicao:  1,
  custo_friccao:    2,
  receita:          3,
  informativo:      4,
  ignorar:          5,
};

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
function fmtBRL(n: number): string { return BRL.format(n); }
function fmtInt(n: number): string { return n.toLocaleString('pt-BR'); }

function defaultEntraCustoTotal(classificacao: string): boolean {
  return classificacao.startsWith('custo_');
}

function emptyForm(transaction_type = '', descricao = '', money_flow: string | null = null): FormState {
  // Pré-seleção inteligente baseada em money_flow quando existe.
  // MONEY_IN → crédito (provável receita), MONEY_OUT → débito (provável custo).
  const nat = money_flow === 'MONEY_IN' ? 'credito' : 'debito';
  return {
    transaction_type,
    classificacao: 'custo_friccao',
    kpi_destino:   'outros',
    descricao_pt:  descricao,
    entra_no_custo_total: true,
    duplica_com:   '',
    natureza:      nat,
  };
}

function rowToForm(r: MappingRow): FormState {
  return {
    transaction_type:     r.transaction_type,
    classificacao:        r.classificacao,
    kpi_destino:          r.kpi_destino,
    descricao_pt:         r.descricao_pt,
    entra_no_custo_total: r.entra_no_custo_total,
    duplica_com:          r.duplica_com ?? '',
    natureza:             r.natureza,
  };
}

export function MappingSection() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ mode: 'new' | 'edit'; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/shopee/mapping', { cache: 'no-store' });
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

  // Dismiss do banner após 4s.
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(t);
  }, [banner]);

  const mapeadosOrdenados = useMemo(() => {
    if (!data) return [];
    return [...data.mapeados].sort((a, b) => {
      const oa = CLASSIFICACAO_ORDER[a.classificacao] ?? 99;
      const ob = CLASSIFICACAO_ORDER[b.classificacao] ?? 99;
      if (oa !== ob) return oa - ob;
      return a.transaction_type.localeCompare(b.transaction_type);
    });
  }, [data]);

  function openNew(u: UnmappedRow) {
    setEditing({
      mode: 'new',
      form: emptyForm(u.transaction_type, u.exemplo_descricao ?? '', u.money_flow),
    });
  }

  function openEdit(r: MappingRow) {
    setEditing({ mode: 'edit', form: rowToForm(r) });
  }

  function close() {
    setEditing(null);
    setSaving(false);
  }

  // Quando classificacao muda, ajusta o default de entra_no_custo_total
  // a menos que o usuário já tenha mexido manualmente — aqui aplicamos
  // direto porque o campo é reversível com 1 clique.
  function onChangeClassificacao(next: string) {
    if (!editing) return;
    setEditing({
      ...editing,
      form: {
        ...editing.form,
        classificacao: next,
        entra_no_custo_total: defaultEntraCustoTotal(next),
      },
    });
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (!editing) return;
    setEditing({ ...editing, form: { ...editing.form, [key]: value } });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/shopee/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editing.form,
          duplica_com: editing.form.duplica_com.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBanner({ type: 'success', message: 'Mapeamento salvo com sucesso' });
      close();
      await load();
    } catch (err) {
      setBanner({ type: 'error', message: err instanceof Error ? err.message : 'Erro ao salvar' });
      setSaving(false);
    }
  }

  async function remove(tt: string) {
    if (!confirm(`Remover mapeamento de "${tt}"? Essa transação voltará a cair em "outros custos" no dashboard.`)) return;
    setDeleting(tt);
    try {
      const res = await fetch('/api/shopee/mapping', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_type: tt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setBanner({ type: 'success', message: `Mapeamento "${tt}" removido` });
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
          Erro ao carregar mapeamentos: {error}
        </div>
      )}

      {/* =================== Transações NÃO mapeadas =================== */}
      <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3 px-1">
        Transações não mapeadas
      </h2>

      {loading ? (
        <div className="card p-6 rounded-lg text-xs opacity-50 mb-6">Carregando…</div>
      ) : !data || data.nao_mapeados.length === 0 ? (
        <div
          className="card p-4 rounded-lg mb-6 text-xs flex items-center gap-2"
          style={{ color: '#1D9E75' }}
        >
          <span>✓</span>
          <span>Todas as transações estão classificadas</span>
        </div>
      ) : (
        <>
          <div
            className="rounded-md px-4 py-2.5 text-xs mb-3"
            style={{ background: 'rgba(239,159,39,0.12)', color: '#8B5F0A', border: '1px solid rgba(239,159,39,0.3)' }}
          >
            <strong>{data.nao_mapeados.length}</strong>{' '}
            {data.nao_mapeados.length === 1 ? 'tipo de transação não classificado' : 'tipos de transação não classificados'}.
            Configure abaixo para contabilização correta no dashboard financeiro.
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
            {data.nao_mapeados.map(u => (
              <div key={u.transaction_type} className="card p-4 rounded-lg flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#378ADD]/15 text-[#378ADD] break-all">
                    {u.transaction_type}
                  </span>
                  {u.money_flow && (
                    <span
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded"
                      style={
                        u.money_flow === 'MONEY_IN'
                          ? { background: 'rgba(29,158,117,0.12)',  color: '#1D9E75' }
                          : { background: 'rgba(226,75,74,0.12)',   color: '#A32D2D' }
                      }
                    >
                      {u.money_flow}
                    </span>
                  )}
                </div>
                <p className="text-[11px] opacity-50 line-clamp-2 min-h-[28px]">
                  {u.exemplo_descricao ?? '(sem descrição)'}
                </p>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="opacity-60">{fmtInt(u.count)} ocorrências (30d)</span>
                  <span
                    className="font-medium"
                    style={{ color: u.total >= 0 ? '#1D9E75' : '#E24B4A' }}
                  >
                    {fmtBRL(u.total)}
                  </span>
                </div>
                <button
                  onClick={() => openNew(u)}
                  className="mt-1 px-3 py-1.5 text-xs rounded-md bg-[#378ADD] text-white hover:opacity-90 transition-opacity"
                >
                  Mapear
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* =================== Transações mapeadas =================== */}
      <h2 className="text-[10px] font-medium uppercase tracking-wider opacity-60 mb-3 px-1">
        Transações mapeadas{' '}
        {!loading && data && (
          <span className="opacity-50">({data.mapeados.length})</span>
        )}
      </h2>

      {loading ? (
        <div className="card p-6 rounded-lg text-xs opacity-50 mb-6">Carregando…</div>
      ) : !data || data.mapeados.length === 0 ? (
        <div className="card p-6 rounded-lg text-xs opacity-60 mb-6 text-center">
          Nenhum mapeamento cadastrado ainda.
        </div>
      ) : (
        <div className="card rounded-lg mb-6 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left opacity-50 border-b border-current/10">
                  <th className="px-3 py-2 font-medium">Tipo</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Classificação</th>
                  <th className="px-3 py-2 font-medium">KPI</th>
                  <th className="px-3 py-2 font-medium">Custo total?</th>
                  <th className="px-3 py-2 font-medium">Duplica com</th>
                  <th className="px-3 py-2 font-medium">Natureza</th>
                  <th className="px-3 py-2 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {mapeadosOrdenados.map(r => {
                  const clsBadge = CLASSIFICACAO_BADGE[r.classificacao] ?? CLASSIFICACAO_BADGE.ignorar;
                  const natBadge = NATUREZA_BADGE[r.natureza] ?? NATUREZA_BADGE.neutro;
                  return (
                    <tr key={r.transaction_type} className="border-t border-current/5">
                      <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                        {r.transaction_type}
                      </td>
                      <td className="px-3 py-2 max-w-[240px] truncate" title={r.descricao_pt}>
                        {r.descricao_pt}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ background: clsBadge.bg, color: clsBadge.color }}
                        >
                          {clsBadge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap opacity-80">
                        {r.kpi_destino}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={
                            r.entra_no_custo_total
                              ? { background: 'rgba(29,158,117,0.12)',  color: '#1D9E75' }
                              : { background: 'rgba(156,163,175,0.14)', color: '#4b5563' }
                          }
                        >
                          {r.entra_no_custo_total ? 'Sim' : 'Não'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] opacity-70">
                        {r.duplica_com ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ background: natBadge.bg, color: natBadge.color }}
                        >
                          {natBadge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => openEdit(r)}
                          className="text-[11px] text-[#378ADD] hover:underline mr-3"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remove(r.transaction_type)}
                          disabled={deleting === r.transaction_type}
                          className="text-[11px] hover:underline disabled:opacity-50"
                          style={{ color: '#E24B4A' }}
                        >
                          {deleting === r.transaction_type ? 'Removendo…' : 'Excluir'}
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
          Quando a Shopee cria um novo tipo de transação na carteira, ele aparece automaticamente
          na seção <strong>&ldquo;Transações não mapeadas&rdquo;</strong> acima.
        </p>
        <p className="mt-2">Configure a classificação para que o dashboard financeiro contabilize corretamente:</p>
        <ul className="mt-2 space-y-1.5 pl-4 list-disc">
          <li><strong>Classificação:</strong> define a categoria (plataforma, aquisição, fricção operacional).</li>
          <li><strong>KPI destino:</strong> define em qual KPI do dashboard o valor aparece.</li>
          <li><strong>Entra no custo total:</strong> define se soma no custo total Shopee.</li>
          <li>
            <strong>Duplica com:</strong> marque se esse tipo duplica informação de outra fonte (ex:
            <code className="font-mono text-[11px] px-1">SPM_DEDUCT</code> duplica com
            <code className="font-mono text-[11px] px-1">shopee_ads_daily</code> e deve ser ignorado).
          </li>
          <li><strong>Natureza:</strong> crédito (dinheiro entra), débito (dinheiro sai) ou neutro.</li>
        </ul>
        <p className="mt-2">Após mapear, o dashboard financeiro atualiza automaticamente na próxima consulta.</p>
      </div>

      {/* =================== Modal de edição =================== */}
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
                  {editing.mode === 'new' ? 'Mapear nova transação' : 'Editar mapeamento'}
                </h3>
                <button onClick={close} className="text-lg opacity-50 hover:opacity-100">×</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 space-y-3">
              <Field label="Transaction type">
                <input
                  type="text"
                  value={editing.form.transaction_type}
                  readOnly
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-current/15 bg-current/5 opacity-70"
                />
              </Field>

              <Field label="Classificação">
                <select
                  value={editing.form.classificacao}
                  onChange={e => onChangeClassificacao(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                >
                  {CLASSIFICACAO_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="KPI destino">
                <select
                  value={editing.form.kpi_destino}
                  onChange={e => updateField('kpi_destino', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                >
                  {KPI_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              <Field label="Descrição em português">
                <input
                  type="text"
                  value={editing.form.descricao_pt}
                  onChange={e => updateField('descricao_pt', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                  placeholder="Ex: Cashback do cartão Shopee"
                />
              </Field>

              <label className="flex items-center gap-2 text-xs cursor-pointer py-1">
                <input
                  type="checkbox"
                  checked={editing.form.entra_no_custo_total}
                  onChange={e => updateField('entra_no_custo_total', e.target.checked)}
                />
                <span>Entra no custo total Shopee</span>
              </label>

              <Field
                label="Duplica com"
                hint="Tabela-fonte alternativa, se houver. Deixe vazio se não duplica."
              >
                <input
                  type="text"
                  value={editing.form.duplica_com}
                  onChange={e => updateField('duplica_com', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-current/15 bg-transparent"
                  placeholder="Ex: shopee_ads_daily"
                />
              </Field>

              <Field label="Natureza">
                <select
                  value={editing.form.natureza}
                  onChange={e => updateField('natureza', e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-current/15 bg-transparent"
                >
                  {NATUREZA_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
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
