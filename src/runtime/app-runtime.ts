import type { AppConfig } from "../config/env";
import { loadConfig } from "../config/env";
import { JobRunner } from "../jobs/job-runner";
import { ReproStore } from "../persistence/store";
import { createProviderRegistry } from "../providers/factory";
import { createLogger } from "../utils/logger";

export async function createRuntime(overrides?: { config?: AppConfig }) {
  const config = overrides?.config ?? loadConfig();
  const logger = createLogger(config.logLevel);
  const providers = createProviderRegistry(config);
  const store = new ReproStore(config);
  await store.initialize();
  const jobs = new JobRunner(providers, store, logger);

  return {
    config,
    logger,
    providers,
    store,
    jobs
  };
}
