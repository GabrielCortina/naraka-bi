'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from './theme-provider';
import { SettingsPanel } from './settings-panel';

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

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

interface SidebarProps {
  onOpenLojaConfig?: () => void;
}

export function Sidebar({ onOpenLojaConfig }: SidebarProps) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const expanded = pinned || hovered;
  const width = expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH;

  useEffect(() => {
    const saved = localStorage.getItem('naraka-bi-sidebar-pinned');
    if (saved === 'true') setPinned(true);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem('naraka-bi-sidebar-pinned', String(pinned));
    }
  }, [pinned, mounted]);

  return (
    <>
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

        {/* Footer */}
        <div className="px-2 pb-3 shrink-0 space-y-0.5">
          {/* Configurações */}
          <button
            onClick={() => setSettingsOpen(true)}
            title={!expanded ? 'Configurações' : undefined}
            className="flex items-center h-9 px-3 rounded-md w-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            style={{ gap: 10 }}
          >
            <span className="shrink-0"><SettingsIcon /></span>
            <span
              className="text-xs whitespace-nowrap overflow-hidden transition-opacity duration-200"
              style={{ opacity: expanded ? 1 : 0 }}
            >
              Configurações
            </span>
          </button>

          {/* Toggle de tema */}
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

      {/* Painel de configurações */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sidebarWidth={width}
        onOpenLojaConfig={onOpenLojaConfig || (() => {})}
      />
    </>
  );
}

export { COLLAPSED_WIDTH, EXPANDED_WIDTH };
