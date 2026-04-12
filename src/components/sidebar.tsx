'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './theme-provider';

const COLLAPSED_WIDTH = 60;
const EXPANDED_WIDTH = 240;

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];

// Ícone hamburger
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);

  const expanded = pinned || hovered;
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  // Carrega estado pinned do localStorage
  useEffect(() => {
    const saved = localStorage.getItem('naraka-bi-sidebar-pinned');
    if (saved === 'true') setPinned(true);
    setMounted(true);
  }, []);

  // Salva estado pinned
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('naraka-bi-sidebar-pinned', String(pinned));
    }
  }, [pinned, mounted]);

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="hidden md:flex fixed top-0 left-0 h-screen flex-col z-40 border-r transition-all duration-200 ease-in-out
        dark:bg-[#0f1117] dark:border-white/[0.06] bg-white border-black/[0.06]"
      style={{ width }}
    >
      {/* Header */}
      <div className="h-14 flex items-center px-4 shrink-0" style={{ gap: 10 }}>
        <button
          onClick={() => setPinned(p => !p)}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0"
          title={pinned ? 'Recolher sidebar' : 'Fixar sidebar'}
        >
          <MenuIcon />
        </button>
        <span
          className="text-sm font-semibold whitespace-nowrap overflow-hidden transition-opacity duration-200"
          style={{ opacity: expanded ? 1 : 0 }}
        >
          NARAKA | <span className="text-[#378ADD]">BI</span>
        </span>
      </div>

      {/* Navegação */}
      <nav className="flex-1 px-2 py-2">
        {NAV_ITEMS.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              title={!expanded ? item.label : undefined}
              className={`flex items-center h-9 px-3 rounded-md mb-0.5 transition-colors ${
                active
                  ? 'bg-[#378ADD]/10 text-[#378ADD]'
                  : 'hover:bg-black/5 dark:hover:bg-white/5 text-current'
              }`}
              style={{ gap: 10 }}
            >
              <span className="shrink-0">{item.icon}</span>
              <span
                className="text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200"
                style={{ opacity: expanded ? 1 : 0 }}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — toggle de tema */}
      <div className="px-2 pb-3 shrink-0">
        <button
          onClick={toggleTheme}
          title={!expanded ? (theme === 'dark' ? 'Modo claro' : 'Modo escuro') : undefined}
          className="flex items-center h-9 px-3 rounded-md w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          style={{ gap: 10 }}
        >
          <span className="shrink-0 text-sm">
            {theme === 'dark' ? '☀' : '☾'}
          </span>
          <span
            className="text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200"
            style={{ opacity: expanded ? 1 : 0 }}
          >
            {theme === 'dark' ? 'Claro' : 'Escuro'}
          </span>
        </button>
      </div>
    </aside>
  );
}

// Exporta constantes para uso no AppShell
export { COLLAPSED_WIDTH, EXPANDED_WIDTH };
