import { createServiceClient } from '@/lib/supabase-server';

// Helper de auditoria para jobs de sync Shopee. Cada execução de
// job abre uma linha em shopee_sync_audit com startAudit e fecha
// com finishAudit (status/duração/contagens). Usa o client service
// compartilhado do resto do módulo.

export interface AuditEntry {
  shop_id: number;
  job_name: string;
  window_from?: string;
  window_to?: string;
}

export interface AuditResult {
  pages_fetched?: number;
  rows_read?: number;
  rows_inserted?: number;
  rows_updated?: number;
  rows_enqueued?: number;
  errors_count?: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
}

export async function startAudit(entry: AuditEntry): Promise<number | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('shopee_sync_audit')
    .insert({
      shop_id: entry.shop_id,
      job_name: entry.job_name,
      started_at: new Date().toISOString(),
      status: 'running',
      window_from: entry.window_from ?? null,
      window_to: entry.window_to ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[audit] Failed to start:', error.message);
    return null;
  }
  return data.id as number;
}

export async function finishAudit(
  auditId: number | null,
  status: 'success' | 'partial' | 'error',
  result: AuditResult,
  startTime: number,
): Promise<void> {
  if (!auditId) return;
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('shopee_sync_audit')
    .update({
      finished_at: new Date().toISOString(),
      status,
      duration_ms: Date.now() - startTime,
      ...result,
    })
    .eq('id', auditId);

  if (error) {
    console.error('[audit] Failed to finish:', error.message);
  }
}
