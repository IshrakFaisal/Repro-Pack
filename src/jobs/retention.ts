import type { AppConfig } from "../config/env";
import type { TenantConfigStore } from "../config/tenant-config";
import type { ReproStore } from "../persistence/store";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export type RetentionCleanupResult = {
  tenantId: string;
  retentionDays: number;
  deletedCount: number;
  dryRun: boolean;
  outcome: "success" | "error";
  error?: string;
};

async function discoverTenantIds(store: ReproStore, tenantConfigStore: TenantConfigStore): Promise<string[]> {
  const tenantIds = new Set<string>(["default"]);
  const [configuredTenants, packs, jobs, auditEvents] = await Promise.all([
    tenantConfigStore.listTenantIds(),
    store.listPacks(),
    store.listJobs(),
    store.listAuditEvents()
  ]);

  for (const tenantId of configuredTenants) {
    tenantIds.add(tenantId);
  }
  for (const pack of packs) {
    tenantIds.add(pack.tenantId);
  }
  for (const job of jobs) {
    tenantIds.add(job.tenantId);
  }
  for (const event of auditEvents) {
    tenantIds.add(event.tenantId);
  }

  return [...tenantIds].sort();
}

export async function runRetentionCleanup(input: {
  config: AppConfig;
  store: ReproStore;
  tenantConfigStore: TenantConfigStore;
  logger: MinimalLogger;
  tenantId?: string;
  dryRun?: boolean;
}): Promise<RetentionCleanupResult[]> {
  const tenantIds = input.tenantId
    ? [input.tenantId]
    : await discoverTenantIds(input.store, input.tenantConfigStore);
  const results: RetentionCleanupResult[] = [];

  for (const tenantId of tenantIds) {
    const tenantConfig = await input.tenantConfigStore.loadRaw(tenantId);
    const retentionDays = tenantConfig?.retentionDays ?? input.config.retentionDays;

    try {
      const deletedCount = await input.store.pruneExpiredData({
        tenantId,
        retentionDays,
        dryRun: input.dryRun
      });
      await input.store.recordAuditEvent({
        tenantId,
        action: "retention.cleanup",
        outcome: "success",
        metadata: { tenantId, deletedCount, retentionDays, dryRun: Boolean(input.dryRun) }
      });
      input.logger.info({ event: "retention.cleanup", tenantId, deletedCount, retentionDays, dryRun: Boolean(input.dryRun) });
      results.push({
        tenantId,
        retentionDays,
        deletedCount,
        dryRun: Boolean(input.dryRun),
        outcome: "success"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown retention cleanup failure";
      await input.store.recordAuditEvent({
        tenantId,
        action: "retention.cleanup",
        outcome: "error",
        metadata: { tenantId, deletedCount: 0, retentionDays, dryRun: Boolean(input.dryRun), error: message }
      });
      input.logger.error({ event: "retention.cleanup.failed", tenantId, retentionDays, error: message });
      results.push({
        tenantId,
        retentionDays,
        deletedCount: 0,
        dryRun: Boolean(input.dryRun),
        outcome: "error",
        error: message
      });
    }
  }

  return results;
}
