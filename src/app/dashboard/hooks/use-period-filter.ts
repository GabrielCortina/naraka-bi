'use client';

import { useState, useMemo } from 'react';
import type { PeriodFilter, DateRange } from '../types';
import { getDateRange } from '../lib/date-utils';

export function usePeriodFilter() {
  const [filter, setFilter] = useState<PeriodFilter>('7dias');
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [loja, setLoja] = useState<string>('');

  const dateRange = useMemo(() => getDateRange(filter, customRange), [filter, customRange]);

  return {
    filter,
    setFilter,
    dateRange,
    customRange,
    setCustomRange,
    loja,
    setLoja,
  };
}
