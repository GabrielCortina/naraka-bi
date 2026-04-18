'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { PresetPeriodo, Alerta, AlertaResumo, PinadoStatus, PeriodosCalculados, BreakdownLoja } from '../lib/types';
import { calcularPeriodos } from '../lib/periodos';

const AUTO_REFRESH_MS = 5 * 60 * 1000;

interface RpcAlertaRow {
  out_sku_pai: string;
  out_tipo: string;
  out_severidade: string;
  out_periodo_a_pecas: number;
  out_periodo_b_pecas: number;
  out_delta_pecas: number;
  out_periodo_a_faturamento: number;
  out_periodo_b_faturamento: number;
  out_delta_faturamento: number;
  out_variacao_pct: number;
  out_score: number;
  out_lojas_afetadas: string[] | null;
  out_breakdown_lojas: BreakdownLoja[] | null;
  out_is_pinado: boolean;
  out_hora_corte?: number;
}

interface RpcResumoRow {
  out_tipo: string;
  out_severidade: string;
  out_quantidade: number;
}

interface RpcPinadoRow {
  out_sku_pai: string;
  out_tipo: string;
  out_severidade: string;
  out_variacao_pct: number;
  out_delta_pecas: number;
  out_delta_faturamento: number;
}

function mapAlerta(row: RpcAlertaRow): Alerta {
  return {
    sku_pai: row.out_sku_pai,
    tipo: row.out_tipo as Alerta['tipo'],
    severidade: row.out_severidade as Alerta['severidade'],
    periodo_a_pecas: Number(row.out_periodo_a_pecas),
    periodo_b_pecas: Number(row.out_periodo_b_pecas),
    delta_pecas: Number(row.out_delta_pecas),
    periodo_a_faturamento: Number(row.out_periodo_a_faturamento),
    periodo_b_faturamento: Number(row.out_periodo_b_faturamento),
    delta_faturamento: Number(row.out_delta_faturamento),
    variacao_pct: Number(row.out_variacao_pct),
    score: Number(row.out_score),
    lojas_afetadas: row.out_lojas_afetadas ?? [],
    breakdown_lojas: (row.out_breakdown_lojas ?? []).map(b => ({
      loja: b.loja,
      delta_pct: b.delta_pct != null ? Number(b.delta_pct) : null,
      delta_pecas: Number(b.delta_pecas),
      delta_faturamento: Number(b.delta_faturamento),
    })),
    is_pinado: row.out_is_pinado,
  };
}

function callRpc(rpc: string, params: Record<string, unknown>, loja: string | null) {
  return fetch('/api/dashboard/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rpc,
      params,
      ...(loja ? { loja } : {}),
    }),
  }).then(r => r.json());
}

export function useAlertas(preset: PresetPeriodo, loja: string, ordenarPor: 'score' | 'pecas' | 'faturamento') {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [resumo, setResumo] = useState<AlertaResumo[]>([]);
  const [pinados, setPinados] = useState<PinadoStatus[]>([]);
  const [periodos, setPeriodos] = useState<PeriodosCalculados>(calcularPeriodos('ontem'));
  const [horaCorte, setHoraCorte] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current;
    const isHoje = preset === 'hoje';
    const p = calcularPeriodos(preset);
    setPeriodos(p);
    const lojaParam = loja || null;

    try {
      if (isHoje) {
        // Preset "Hoje": RPCs dedicadas com comparação por hora
        const [alertasRes, pinadosRes] = await Promise.all([
          callRpc('rpc_alertas_calcular_hoje', { p_ordenar_por: ordenarPor }, lojaParam),
          callRpc('rpc_alertas_pinados_status_hoje', {}, lojaParam),
        ]);

        if (currentFetchId !== fetchIdRef.current) return;

        const alertaRows = (alertasRes.data ?? []) as RpcAlertaRow[];
        const mapped = alertaRows.map(mapAlerta);
        setAlertas(mapped);

        const hora = alertaRows.length > 0 && alertaRows[0].out_hora_corte != null
          ? Number(alertaRows[0].out_hora_corte)
          : null;
        setHoraCorte(hora);

        // Resumo calculado local
        const resumoMap = new Map<string, { tipo: string; severidade: string; quantidade: number }>();
        for (const a of mapped) {
          const key = `${a.tipo}|${a.severidade}`;
          const existing = resumoMap.get(key);
          if (existing) existing.quantidade++;
          else resumoMap.set(key, { tipo: a.tipo, severidade: a.severidade, quantidade: 1 });
        }
        setResumo(Array.from(resumoMap.values()));

        // Pinados via RPC dedicada (inclui estáveis)
        const pinadoRows = (pinadosRes.data ?? []) as RpcPinadoRow[];
        setPinados(pinadoRows.map(r => ({
          sku_pai: r.out_sku_pai,
          tipo: r.out_tipo as PinadoStatus['tipo'],
          severidade: r.out_severidade as PinadoStatus['severidade'],
          variacao_pct: Number(r.out_variacao_pct),
          delta_pecas: Number(r.out_delta_pecas),
          delta_faturamento: Number(r.out_delta_faturamento),
        })));
      } else {
        // Presets normais: usa RPCs existentes
        setHoraCorte(null);
        const periodoParams = {
          p_periodo_a_inicio: p.periodoA.inicio,
          p_periodo_a_fim: p.periodoA.fim,
          p_periodo_b_inicio: p.periodoB.inicio,
          p_periodo_b_fim: p.periodoB.fim,
        };

        const [alertasRes, resumoRes, pinadosRes] = await Promise.all([
          callRpc('rpc_alertas_calcular', { ...periodoParams, p_ordenar_por: ordenarPor }, lojaParam),
          callRpc('rpc_alertas_resumo', periodoParams, lojaParam),
          callRpc('rpc_alertas_pinados_status', periodoParams, lojaParam),
        ]);

        if (currentFetchId !== fetchIdRef.current) return;

        const alertaRows = (alertasRes.data ?? []) as RpcAlertaRow[];
        setAlertas(alertaRows.map(mapAlerta));

        const resumoRows = (resumoRes.data ?? []) as RpcResumoRow[];
        setResumo(resumoRows.map(r => ({
          tipo: r.out_tipo,
          severidade: r.out_severidade,
          quantidade: Number(r.out_quantidade),
        })));

        const pinadoRows = (pinadosRes.data ?? []) as RpcPinadoRow[];
        setPinados(pinadoRows.map(r => ({
          sku_pai: r.out_sku_pai,
          tipo: r.out_tipo as PinadoStatus['tipo'],
          severidade: r.out_severidade as PinadoStatus['severidade'],
          variacao_pct: Number(r.out_variacao_pct),
          delta_pecas: Number(r.out_delta_pecas),
          delta_faturamento: Number(r.out_delta_faturamento),
        })));
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error('[useAlertas] exceção:', err);
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [preset, loja, ordenarPor]);

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchData();
      }
    }, AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // No preset "hoje", refetch imediato quando vira a hora (checa a cada 60s)
  useEffect(() => {
    if (preset !== 'hoje') return;
    let lastHour = new Date().getHours();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const currentHour = new Date().getHours();
      if (currentHour !== lastHour) {
        lastHour = currentHour;
        fetchData();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [preset, fetchData]);

  const quedas = alertas.filter(a => a.tipo === 'QUEDA');
  const picos = alertas.filter(a => a.tipo === 'PICO');

  return { alertas, quedas, picos, resumo, pinados, periodos, horaCorte, loading, lastUpdated, refetch: fetchData };
}
