'use client';

import { useState, useEffect, useMemo } from 'react';
import type {
  AlteracaoFormData,
  TipoAlteracao,
  ImpactoEsperado,
} from '../lib/types';
import { TIPOS_ALTERACAO, MOTIVOS } from '../lib/types';

interface LojaOption {
  nome_exibicao: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (data: AlteracaoFormData) => Promise<{ success: boolean; error?: string }>;
  lojas: LojaOption[];
}

function pad2(n: number): string { return String(n).padStart(2, '0'); }
function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function AlteracaoModal({ open, onClose, onSave, lojas }: Props) {
  const [dataAlteracao, setDataAlteracao] = useState(hoje());
  const [sku, setSku] = useState('');
  const [tipo, setTipo] = useState<TipoAlteracao>('preco');
  const [loja, setLoja] = useState<string>('');
  const [todasLojas, setTodasLojas] = useState(false);
  const [valorAntes, setValorAntes] = useState('');
  const [valorDepois, setValorDepois] = useState('');
  const [motivo, setMotivo] = useState('');
  const [impacto, setImpacto] = useState<ImpactoEsperado | ''>('');
  const [tagsInput, setTagsInput] = useState('');
  const [observacao, setObservacao] = useState('');
  const [responsavel, setResponsavel] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tagsArr = useMemo(
    () => tagsInput.split(',').map(t => t.trim()).filter(Boolean),
    [tagsInput],
  );

  useEffect(() => {
    if (open) {
      setDataAlteracao(hoje());
      setSku('');
      setTipo('preco');
      setLoja('');
      setTodasLojas(false);
      setValorAntes('');
      setValorDepois('');
      setMotivo('');
      setImpacto('');
      setTagsInput('');
      setObservacao('');
      setResponsavel('');
      setError(null);
      setSaving(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = async () => {
    setError(null);

    if (!dataAlteracao) { setError('Data é obrigatória'); return; }
    if (!sku.trim())    { setError('SKU é obrigatório'); return; }
    if (!tipo)          { setError('Tipo é obrigatório'); return; }

    setSaving(true);

    const payload: AlteracaoFormData = {
      data_alteracao: dataAlteracao,
      sku: sku.trim(),
      tipo_alteracao: tipo,
      loja: todasLojas ? null : (loja || null),
      valor_antes: valorAntes.trim() || undefined,
      valor_depois: valorDepois.trim() || undefined,
      motivo: motivo || undefined,
      impacto_esperado: impacto || undefined,
      tags: tagsArr.length > 0 ? tagsArr : undefined,
      observacao: observacao.trim() || undefined,
      responsavel: responsavel.trim() || undefined,
    };

    const res = await onSave(payload);

    if (res.success) {
      onClose();
    } else {
      setError(res.error ?? 'Erro ao salvar');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg shadow-xl my-8 dark:bg-[#0f1117] bg-white border border-current/10"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-current/10">
          <h2 className="text-base font-semibold">Nova Alteração</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title="Fechar"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Data */}
          <div>
            <label className="block text-xs font-medium mb-1">Data da Alteração <span className="text-red-500">*</span></label>
            <input
              type="date"
              value={dataAlteracao}
              onChange={e => setDataAlteracao(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
            />
          </div>

          {/* SKU */}
          <div>
            <label className="block text-xs font-medium mb-1">SKU <span className="text-red-500">*</span></label>
            <input
              type="text"
              value={sku}
              onChange={e => setSku(e.target.value)}
              placeholder="Ex.: 41471"
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent font-mono"
            />
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium mb-1">Tipo de Alteração <span className="text-red-500">*</span></label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as TipoAlteracao)}
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
            >
              {TIPOS_ALTERACAO.map(t => (
                <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
              ))}
            </select>
          </div>

          {/* Loja */}
          <div>
            <label className="block text-xs font-medium mb-1">Loja</label>
            <div className="flex items-center gap-2">
              <select
                value={loja}
                onChange={e => setLoja(e.target.value)}
                disabled={todasLojas}
                className="flex-1 px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent disabled:opacity-50"
              >
                <option value="">Selecione...</option>
                {lojas.map(l => (
                  <option key={l.nome_exibicao} value={l.nome_exibicao}>{l.nome_exibicao}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={todasLojas}
                  onChange={e => { setTodasLojas(e.target.checked); if (e.target.checked) setLoja(''); }}
                />
                Todas as lojas
              </label>
            </div>
          </div>

          <div className="h-px bg-current/10 my-2" />

          {/* Antes / Depois */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Antes</label>
              <input
                type="text"
                value={valorAntes}
                onChange={e => setValorAntes(e.target.value)}
                placeholder="Ex.: R$ 69,99"
                className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Depois</label>
              <input
                type="text"
                value={valorDepois}
                onChange={e => setValorDepois(e.target.value)}
                placeholder="Ex.: R$ 79,99"
                className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
              />
            </div>
          </div>

          {/* Motivo */}
          <div>
            <label className="block text-xs font-medium mb-1">Motivo</label>
            <select
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
            >
              <option value="">Selecione...</option>
              {MOTIVOS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Impacto Esperado */}
          <div>
            <label className="block text-xs font-medium mb-1">Impacto Esperado</label>
            <div className="flex gap-2">
              {([['alta', 'Alta'], ['queda', 'Queda'], ['neutro', 'Neutro']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setImpacto(impacto === key ? '' : key)}
                  className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                    impacto === key
                      ? 'bg-[#378ADD] text-white'
                      : 'border border-current/10 hover:border-current/30'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium mb-1">Tags</label>
            <input
              type="text"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              placeholder="Separadas por vírgula — Ex.: Teste, Q2"
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
            />
            {tagsArr.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tagsArr.map(tag => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[#378ADD]/10 text-[#378ADD]">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Observação */}
          <div>
            <label className="block text-xs font-medium mb-1">Observação</label>
            <textarea
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              rows={3}
              placeholder="Detalhes, contexto..."
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent resize-none"
            />
          </div>

          {/* Responsável */}
          <div>
            <label className="block text-xs font-medium mb-1">Responsável</label>
            <input
              type="text"
              value={responsavel}
              onChange={e => setResponsavel(e.target.value)}
              placeholder="Ex.: Gabriel"
              className="w-full px-3 py-2 text-sm rounded-md border border-current/10 bg-transparent"
            />
          </div>

          {error && (
            <div className="text-xs text-red-500 bg-red-500/10 rounded-md p-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-current/10">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-xs rounded-md border border-current/10 hover:border-current/30 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-xs font-medium rounded-md bg-[#378ADD] text-white hover:brightness-110 transition-colors disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar Alteração'}
          </button>
        </div>
      </div>
    </div>
  );
}
