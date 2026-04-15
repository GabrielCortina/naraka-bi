'use client';

import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from './sidebar';
import { LojaConfigModal } from '@/app/dashboard/components/loja-config-modal';
import { SkuAliasModal } from '@/app/dashboard/components/sku-alias-modal';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [configOpen, setConfigOpen] = useState(false);
  const [skuAliasOpen, setSkuAliasOpen] = useState(false);
  const [skuAliasTab, setSkuAliasTab] = useState<'alias' | 'kits'>('alias');

  // Sidebar (qualquer página) dispara este evento para abrir o modal.
  // O dashboard-client também dispara — assim o botão "⚙ Lojas" no
  // header e o item da sidebar usam o mesmo caminho.
  const handleOpenLojaConfig = useCallback(() => {
    window.dispatchEvent(new CustomEvent('naraka:open-loja-config'));
  }, []);

  useEffect(() => {
    const handler = () => setConfigOpen(true);
    window.addEventListener('naraka:open-loja-config', handler);
    return () => window.removeEventListener('naraka:open-loja-config', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: 'alias' | 'kits' }>).detail;
      setSkuAliasTab(detail?.tab === 'kits' ? 'kits' : 'alias');
      setSkuAliasOpen(true);
    };
    window.addEventListener('naraka:open-sku-alias', handler);
    return () => window.removeEventListener('naraka:open-sku-alias', handler);
  }, []);

  // Quando o modal salva, despacha evento global. O dashboard-client
  // (se montado) escuta e incrementa refreshKey para revalidar dados.
  const handleSaved = useCallback(() => {
    window.dispatchEvent(new CustomEvent('naraka:loja-config-saved'));
    setConfigOpen(false);
  }, []);

  return (
    <div className="min-h-screen dark:bg-[#0f1117] dark:text-white bg-[#f8f9fa] text-[#111827] transition-colors duration-200">
      <Sidebar onOpenLojaConfig={handleOpenLojaConfig} />
      <main className="md:ml-[60px]">
        {children}
      </main>

      {/* Modal global — funciona em qualquer página. */}
      <LojaConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={handleSaved}
      />

      <SkuAliasModal
        open={skuAliasOpen}
        onClose={() => setSkuAliasOpen(false)}
        initialTab={skuAliasTab}
      />
    </div>
  );
}
