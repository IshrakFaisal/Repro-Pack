import type { AuditEvent } from "../types/integrations";
import type { ProcessingJob, StoredReproPack } from "../types/schemas";

export interface PersistenceBackend {
  initialize(): Promise<void>;
  pruneExpiredData(input: { tenantId: string; retentionDays: number; dryRun?: boolean }): Promise<number>;
  listJobs(tenantId?: string): Promise<ProcessingJob[]>;
  getJob(jobId: string, tenantId: string): Promise<ProcessingJob | undefined>;
  saveJob(job: ProcessingJob): Promise<void>;
  listPacks(tenantId?: string): Promise<StoredReproPack[]>;
  getPack(ticketId: string, tenantId: string): Promise<StoredReproPack | undefined>;
  savePack(pack: StoredReproPack): Promise<void>;
  listAuditEvents(tenantId?: string): Promise<AuditEvent[]>;
  saveAuditEvent(event: AuditEvent): Promise<void>;
}
