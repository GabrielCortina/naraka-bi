'use client';

import { CustosSection } from './custos-section';

export default function CustosConfigPage() {
  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          NARAKA | <span className="text-[#378ADD]">Configuração de custos</span>
        </h1>
        <p className="text-xs mt-0.5 opacity-50">
          Cadastre custos de mercadoria (CMV) por SKU para cálculo de lucro
        </p>
      </div>

      <CustosSection />
    </div>
  );
}
