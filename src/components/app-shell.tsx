'use client';

import { useCallback } from 'react';
import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  // Dispara evento customizado para abrir config de lojas (ouvido pelo dashboard-client)
  const handleOpenLojaConfig = useCallback(() => {
    window.dispatchEvent(new CustomEvent('naraka:open-loja-config'));
  }, []);

  return (
    <div className="min-h-screen dark:bg-[#0f1117] dark:text-white bg-[#f8f9fa] text-[#111827] transition-colors duration-200">
      <Sidebar onOpenLojaConfig={handleOpenLojaConfig} />
      <main className="md:ml-[60px]">
        {children}
      </main>
    </div>
  );
}
