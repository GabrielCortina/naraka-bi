'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { PresetPeriodo } from './lib/types';
import { useAlertas } from './hooks/useAlertas';
import { usePinados } from './hooks/usePinados';
import { useAlertasIA } from './hooks/useAlertasIA';
import { useSkuModal } from './hooks/useSkuModal';
import { AlertasHeader } from './components/AlertasHeader';
import { AlertasPinados } from './components/AlertasPinados';
import { AlertasGrid } from './components/AlertasGrid';
import { AlertasIA } from './components/AlertasIA';
import { SkuModal } from './components/SkuModal';

interface LojaOption {
  nome_exibicao: string;
}

export default function AlertasPage() {
  const [preset, setPreset] = useState<PresetPeriodo>('ontem');
  const [loja, setLoja] = useState('');
  const [ordenarPor, setOrdenarPor] = useState<'score' | 'pecas' | 'faturamento'>('score');
  const [lojas, setLojas] = useState<LojaOption[]>([]);

  const { quedas, picos, resumo, pinados, periodos, horaCorte, loading, lastUpdated, refetch, alertas } = useAlertas(preset, loja, ordenarPor);
  const { togglePin, isToggling } = usePinados(refetch);
  const ia = useAlertasIA();
  const skuModal = useSkuModal();

  const loadLojas = useCallback(async () => {
    const db = createBrowserClient();
    const { data: configs } = await db.from('loja_config')
      .select('nome_exibicao, nome_loja')
      .eq('ativo', true)
      .order('nome_exibicao');

    if (configs && configs.length > 0) {
      const nomes = configs.map(c => c.nome_loja || c.nome_exibicao);
      const unicos = Array.from(new Set(nomes)).sort();
      setLojas(unicos.map(nome => ({ nome_exibicao: nome })));
    }
  }, []);

  useEffect(() => { loadLojas(); }, [loadLojas]);

  const handleGerarIA = useCallback(() => {
    ia.gerarAnalise(
      alertas.slice(0, 20),
      pinados,
      periodos.label,
      loja ? [loja] : undefined,
    );
  }, [ia, alertas, pinados, periodos.label, loja]);

  return (
    <div className="max-w-[1400px] mx-auto p-4 md:p-6">
      <AlertasHeader
        preset={preset}
        onPresetChange={setPreset}
        loja={loja}
        onLojaChange={setLoja}
        lojas={lojas}
        ordenarPor={ordenarPor}
        onOrdenarPorChange={setOrdenarPor}
        periodos={periodos}
        horaCorte={horaCorte}
        lastUpdated={lastUpdated}
      />

      <AlertasPinados
        pinados={pinados}
        loading={loading}
        onUnpin={togglePin}
        onPin={togglePin}
        isToggling={isToggling}
      />

      <AlertasGrid
        quedas={quedas}
        picos={picos}
        resumo={resumo}
        loading={loading}
        onPin={togglePin}
        isPinToggling={isToggling}
        onCardClick={skuModal.openModal}
        iaColumn={
          <AlertasIA
            texto={ia.texto}
            loading={ia.loading}
            geradoEm={ia.geradoEm}
            error={ia.error}
            onGerar={handleGerarIA}
          />
        }
      />

      <SkuModal
        state={skuModal}
        lojasDisponiveis={lojas.map(l => l.nome_exibicao)}
      />
    </div>
  );
}
