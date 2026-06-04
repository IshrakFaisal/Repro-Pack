import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { FilesystemPersistenceBackend } from "../src/persistence/filesystem-backend";
import { ReproStore } from "../src/persistence/store";
import { createApp } from "../src/server/app";

describe("production readiness", () => {
  const originalEnv = { ...process.env };
  let baseDir = "";

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-prod-ready-"));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts tenant-scoped API keys and rejects missing credentials", async () => {
    const tenantRoot = path.join(baseDir, "tenants");
    await fs.mkdir(tenantRoot, { recursive: true });
    process.env.TENANT_CONFIG_ROOT = tenantRoot;
    process.env.DATA_ROOT = path.join(baseDir, "data");
    process.env.ARTIFACT_OUTPUT_DIR = path.join(baseDir, "artifacts");
    process.env.FIXTURE_ROOT = "fixtures/cases";
    process.env.LOG_LEVEL = "silent";
    delete process.env.API_KEY;
    process.env.ACME_TENANT_KEY = "tenant-secret";

    await fs.writeFile(
      path.join(tenantRoot, "acme.json"),
      JSON.stringify(
        {
          tenantId: "acme",
          name: "Acme",
          auth: {
            apiKeys: [
              {
                keyId: "primary",
                actorId: "support-ops",
                secret: { env: "ACME_TENANT_KEY" },
                roles: ["read", "process", "review", "sync"]
              }
            ]
          },
          providers: {}
        },
        null,
        2
      ),
      "utf8"
    );

    const app = await createApp();
    const authorized = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers: { "x-api-key": "tenant-secret" },
      payload: {
        tenantId: "acme",
        fixtureId: "browser-only-complaint",
        dryRun: true
      }
    });

    const unauthorized = await app.inject({
      method: "POST",
      url: "/tickets/process",
      payload: {
        tenantId: "acme",
        fixtureId: "browser-only-complaint",
        dryRun: true
      }
    });
    await app.close();

    expect(authorized.statusCode).toBe(200);
    expect(authorized.json().tenantId).toBe("acme");
    expect(unauthorized.statusCode).toBe(401);
  });

  it("requeues leased jobs after a restart boundary", async () => {
    const config: AppConfig = {
      port: 0,
      logLevel: "silent",
      fixtureRoot: path.resolve(process.cwd(), "fixtures/cases"),
      artifactOutputDir: path.join(baseDir, "artifacts"),
      dataRoot: path.join(baseDir, "data"),
      tenantConfigRoot: path.join(baseDir, "tenants"),
      storageDriver: "fs",
      sqliteDatabasePath: path.join(baseDir, "repro-pack.sqlite"),
      processTimeoutMs: 2500,
      httpTimeoutMs: 2000,
      llmTimeoutMs: 10000,
      maxProviderRetries: 1,
      queuePollMs: 10,
      queueLeaseMs: 1000,
      queueMaxAttempts: 3,
      retentionDays: 30,
      redactIps: true,
      redactDirectIdentifiers: true,
      dataResidencyMode: "standard",
      requireCustomerConsent: false,
      appVersion: "test",
      buildHash: "test-build",
      apiKey: "test-key"
    };

    const firstStore = new ReproStore(config, new FilesystemPersistenceBackend(config.dataRoot));
    await firstStore.initialize();
    await firstStore.saveJob({
      jobId: "job-1",
      status: "running",
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      leaseExpiresAt: "2026-06-03T00:00:01.000Z",
      tenantId: "default",
      dryRun: true,
      writeArtifacts: false,
      customerConsentConfirmed: false,
      attempts: 1,
      maxAttempts: 3,
      sourceLookup: { fixtureId: "browser-only-complaint" }
    });

    const secondStore = new ReproStore(config, new FilesystemPersistenceBackend(config.dataRoot));
    await secondStore.initialize();
    const recovered = await secondStore.getJob("job-1");

    expect(recovered?.status).toBe("queued");
    expect(recovered?.leaseExpiresAt).toBeUndefined();
  });
});
