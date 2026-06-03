import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { AppConfig } from "../../src/config/env";
import { MetricsRegistry } from "../../src/observability/metrics";
import { createProviderRegistry } from "../../src/providers/factory";
import { createSecretManager } from "../../src/secrets/manager";

export async function createTestSetup() {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-test-"));
  const config: AppConfig = {
    port: 0,
    logLevel: "silent",
    fixtureRoot: path.resolve(process.cwd(), "fixtures/cases"),
    artifactOutputDir: artifactDir,
    dataRoot: path.join(artifactDir, "data"),
    tenantConfigRoot: path.join(artifactDir, "tenants"),
    storageDriver: "fs",
    sqliteDatabasePath: path.join(artifactDir, "repro-pack.sqlite"),
    processTimeoutMs: 2500,
    httpTimeoutMs: 2000,
    maxProviderRetries: 1,
    queuePollMs: 10,
    queueLeaseMs: 1000,
    retentionDays: 30,
    redactIps: true,
    redactDirectIdentifiers: true,
    appVersion: "1.0.0-test",
    buildHash: "build-test",
    apiKey: "test-api-key"
  };

  const providerRegistry = createProviderRegistry(config, createSecretManager(), new MetricsRegistry());

  return {
    config,
    providers: await providerRegistry.create(),
    providerRegistry,
    artifactDir,
    logger: {
      info: () => undefined,
      error: () => undefined
    }
  };
}
