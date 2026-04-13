import type { PeriodFilter, DateRange } from '../types';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Formata data como yyyy-MM-dd no fuso local (evita problema UTC vs BRT)
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function hoje(): string {
  return formatYmd(new Date());
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Retorna DateRange para o filtro selecionado
export function getDateRange(filter: PeriodFilter, custom?: DateRange): DateRange {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  switch (filter) {
    case 'hoje':
      return { start: formatYmd(now), end: formatYmd(now) };
    case 'ontem': {
      const ontem = new Date(y, m, d - 1);
      return { start: formatYmd(ontem), end: formatYmd(ontem) };
    }
    case '7dias': {
      const inicio = new Date(y, m, d - 6);
      return { start: formatYmd(inicio), end: formatYmd(now) };
    }
    case '15dias': {
      const inicio = new Date(y, m, d - 14);
      return { start: formatYmd(inicio), end: formatYmd(now) };
    }
    case 'mes_atual':
      return { start: formatYmd(new Date(y, m, 1)), end: formatYmd(now) };
    case 'mes_anterior': {
      const primeiroDia = new Date(y, m - 1, 1);
      const ultimoDia = new Date(y, m, 0);
      return { start: formatYmd(primeiroDia), end: formatYmd(ultimoDia) };
    }
    case 'personalizado':
      return custom || { start: formatYmd(now), end: formatYmd(now) };
  }
}

// Calcula o período anterior de mesma duração
export function getPeriodoAnterior(range: DateRange): DateRange {
  const start = new Date(range.start);
  const end = new Date(range.end);
  const dias = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const anteriorEnd = new Date(start.getTime() - 1000 * 60 * 60 * 24);
  const anteriorStart = new Date(anteriorEnd.getTime() - (dias - 1) * 1000 * 60 * 60 * 24);
  return { start: formatYmd(anteriorStart), end: formatYmd(anteriorEnd) };
}

// Número de dias no range
export function diasNoRange(range: DateRange): number {
  const start = new Date(range.start);
  const end = new Date(range.end);
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

// Dias restantes no mês atual
export function diasRestantesMes(): number {
  const now = new Date();
  const ultimoDia = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return ultimoDia - now.getDate();
}

// O período inclui dias do mês atual?
export function periodoIncluiMesAtual(range: DateRange): boolean {
  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return range.end >= `${mesAtual}-01`;
}

// Formata data para exibição: "DD/MM Seg"
export function formatDataCurta(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes} ${DIAS_SEMANA[d.getDay()]}`;
}

// Formata valor monetário brasileiro
export function formatBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Formata valor abreviado: R$ 12k, R$ 1.2M
export function formatBRLCurto(valor: number): string {
  if (valor >= 1_000_000) return `R$ ${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `R$ ${(valor / 1_000).toFixed(0)}k`;
  return formatBRL(valor);
}

// Formata número com separador de milhar
export function formatNumero(n: number): string {
  return n.toLocaleString('pt-BR');
}

// Calcula variação percentual
export function calcVariacao(atual: number, anterior: number): number {
  if (anterior === 0) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / anterior) * 100;
}

// Nome do dia da semana
export function nomeDiaSemana(dow: number): string {
  return DIAS_SEMANA[dow] || '';
}
