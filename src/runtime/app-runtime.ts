import type { AppConfig } from "../config/env";
import { loadConfig } from "../config/env";
import { JobRunner } from "../jobs/job-runner";
import { runRetentionCleanup } from "../jobs/retention";
import { MetricsRegistry } from "../observability/metrics";
import { FilesystemPersistenceBackend } from "../persistence/filesystem-backend";
import { ReproStore } from "../persistence/store";
import { SqlitePersistenceBackend } from "../persistence/sqlite-backend";
import { TenantConfigStore } from "../config/tenant-config";
import { createProviderRegistry } from "../providers/factory";
import { createSecretManager } from "../secrets/manager";
import { createLogger } from "../utils/logger";

export async function createRuntime(overrides?: { config?: AppConfig; skipRetentionCleanup?: boolean }) {
  const config = overrides?.config ?? loadConfig();
  const logger = createLogger(config.logLevel);
  const secretManager = createSecretManager();
  const metrics = new MetricsRegistry();
  const providers = createProviderRegistry(config, secretManager, metrics, logger);
  const backend =
    config.storageDriver === "sqlite"
      ? new SqlitePersistenceBackend(config.sqliteDatabasePath)
      : new FilesystemPersistenceBackend(config.dataRoot);
  const store = new ReproStore(config, backend);
  await store.initialize();
  const tenantConfigStore = new TenantConfigStore(config, secretManager);
  if (!overrides?.skipRetentionCleanup) {
    await runRetentionCleanup({ config, store, tenantConfigStore, logger });
  }
  const jobs = new JobRunner(providers, store, logger, metrics, config);
  await jobs.start();

  return {
    config,
    logger,
    metrics,
    secretManager,
    tenantConfigStore,
    providers,
    store,
    jobs
  };
}
