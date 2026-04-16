'use client';

import { useCallback, useState } from 'react';

export function usePinados(onToggled: () => void) {
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const togglePin = useCallback(async (skuPai: string) => {
    setToggling(prev => new Set(prev).add(skuPai));
    try {
      const res = await fetch('/api/alertas/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku_pai: skuPai }),
      });
      if (!res.ok) {
        const json = await res.json();
        console.error('[pin] erro:', json.error);
        return;
      }
      onToggled();
    } catch (err) {
      console.error('[pin] exceção:', err);
    } finally {
      setToggling(prev => {
        const next = new Set(prev);
        next.delete(skuPai);
        return next;
      });
    }
  }, [onToggled]);

  return { togglePin, isToggling: (sku: string) => toggling.has(sku) };
}
