'use client';

import Link from 'next/link';

interface Props {
  open: boolean;
  onClose: () => void;
  sidebarWidth: number;
  onOpenLojaConfig: () => void;
}

function SettingsItem({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-between w-full h-10 px-3.5 text-sm rounded-md
        hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-[10px] opacity-30">→</span>
    </button>
  );
}

export function SettingsPanel({ open, onClose, sidebarWidth, onOpenLojaConfig }: Props) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop invisível */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Painel */}
      <div
        className="fixed top-0 h-screen z-45 border-r
          dark:bg-[#141620] dark:border-white/[0.06] bg-[#fafafa] border-black/[0.06]"
        style={{
          left: sidebarWidth,
          width: 260,
          animation: 'slideInLeft 200ms ease',
          zIndex: 45,
        }}
      >
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b dark:border-white/[0.06] border-black/[0.06]">
          <span className="text-xs font-medium">Configurações</span>
          <button onClick={onClose} className="text-lg opacity-50 hover:opacity-100">×</button>
        </div>

        {/* Seções */}
        <div className="p-2">
          <p className="text-[9px] uppercase tracking-wider opacity-40 px-3.5 py-2">Sistema</p>
          <Link href="/sistema/api" onClick={onClose}>
            <SettingsItem icon="⚡" label="API & Monitoramento" onClick={onClose} />
          </Link>
          <Link href="/shopee-status" onClick={onClose}>
            <SettingsItem icon="🔶" label="Shopee Sync" onClick={onClose} />
          </Link>
        </div>

        <div className="mx-3.5 border-t dark:border-white/[0.06] border-black/[0.06]" />

        <div className="p-2">
          <p className="text-[9px] uppercase tracking-wider opacity-40 px-3.5 py-2">Dados</p>
          <SettingsItem icon="🏪" label="Configurar lojas" onClick={() => { onOpenLojaConfig(); onClose(); }} />
          <SettingsItem
            icon="🏷️"
            label="Mapeamento de SKU"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('naraka:open-sku-alias', { detail: { tab: 'alias' } }));
              onClose();
            }}
          />
          <SettingsItem
            icon="📦"
            label="Mapeamento de Kits"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('naraka:open-sku-alias', { detail: { tab: 'kits' } }));
              onClose();
            }}
          />
          <Link href="/configuracoes/custos" onClick={onClose}>
            <SettingsItem icon="💲" label="Custos" onClick={onClose} />
          </Link>
        </div>

        <div className="mx-3.5 border-t dark:border-white/[0.06] border-black/[0.06]" />

        <div className="p-2">
          <p className="text-[9px] uppercase tracking-wider opacity-40 px-3.5 py-2">Integrações</p>
          <Link href="/configuracoes/shopee" onClick={onClose}>
            <SettingsItem icon="🔶" label="Shopee" onClick={onClose} />
          </Link>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t dark:border-white/[0.06] border-black/[0.06]">
          <p className="text-[9px] opacity-30">naraka-bi v1.0</p>
        </div>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>
  );
}
