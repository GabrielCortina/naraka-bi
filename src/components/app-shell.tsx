'use client';

import { Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen dark:bg-[#0f1117] dark:text-white bg-[#f8f9fa] text-[#111827] transition-colors duration-200">
      <Sidebar />
      {/* Em mobile: sem margem. Em desktop: margem fixa de 60px (sidebar recolhida).
          Quando a sidebar expande no hover, ela sobrepõe o conteúdo (overlay). */}
      <main className="md:ml-[60px]">
        {children}
      </main>
    </div>
  );
}
