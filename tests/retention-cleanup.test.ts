import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config/env";
import { TenantConfigStore } from "../src/config/tenant-config";
import { runRetentionCleanup } from "../src/jobs/retention";
import { FilesystemPersistenceBackend } from "../src/persistence/filesystem-backend";
import { ReproStore } from "../src/persistence/store";
import { createSecretManager } from "../src/secrets/manager";
import type { StoredReproPack } from "../src/types/schemas";

function makeConfig(baseDir: string): AppConfig {
  return {
    port: 0,
    logLevel: "silent",
    fixtureRoot: "fixtures/cases",
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
    buildHash: "test",
    apiKey: "test-key"
  };
}

function makePack(tenantId: string, ticketId: string, updatedAt: string): StoredReproPack {
  return {
    tenantId,
    ticketId,
    status: "draft",
    createdAt: updatedAt,
    updatedAt,
    dryRun: true,
    sourceLookup: {},
    reproPack: {
      ticketId,
      summary: "Checkout fails",
      customerImpact: "Checkout fails",
      reproSteps: [{ step: "Open /checkout.", source: "telemetry", confidence: 0.8 }],
      expectedBehavior: "Checkout succeeds",
      actualBehavior: "Checkout fails",
      environment: {
        browser: "Chrome",
        browserVersion: "120",
        device: "Desktop",
        os: "Windows",
        appVersion: "1.0.0",
        buildHash: "abc123"
      },
      featureFlags: [],
      timeline: [],
      logs: [],
      samplePayload: {},
      sanitizationReport: [],
      evidence: [],
      confidence: { overall: 0.82, reasoning: "test", factors: [] },
      minimalReproSequence: [{ step: "Open /checkout.", source: "telemetry", confidence: 0.8 }],
      alternativeReproPaths: [],
      environmentDeltas: [],
      regressionClassification: {
        classification: "unknown",
        reasoning: "test",
        signals: []
      },
      redactionAuditReport: null,
      compliance: {
        dataResidencyMode: "standard",
        llmUsed: false,
        customerConsentRequired: false,
        customerConsentConfirmed: false
      },
      llmSuggestions: null
    },
    issueDraft: {
      ticketId,
      title: `[repro-pack] ${ticketId}`,
      body: "body",
      labels: []
    },
    markdown: "body",
    providerResults: {},
    issueLinks: [],
    reviewHistory: []
  };
}

async function writeTenant(root: string, tenantId: string, retentionDays: number): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, `${tenantId}.json`),
    JSON.stringify({ tenantId, name: tenantId, retentionDays, auth: { apiKeys: [] }, providers: {} }, null, 2),
    "utf8"
  );
}

const logger = {
  info: () => undefined,
  error: () => undefined
};

describe("retention cleanup", () => {
  it("applies tenant-specific retention cutoffs and records audit events", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-retention-"));
    const config = makeConfig(baseDir);
    const store = new ReproStore(config, new FilesystemPersistenceBackend(config.dataRoot));
    await store.initialize();
    await writeTenant(config.tenantConfigRoot, "alpha", 1);
    await writeTenant(config.tenantConfigRoot, "beta", 30);
    const tenantConfigStore = new TenantConfigStore(config, createSecretManager());
    const oldTimestamp = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    await store.savePack(makePack("alpha", "old-alpha", oldTimestamp));
    await store.savePack(makePack("beta", "old-beta", oldTimestamp));

    const dryRunResults = await runRetentionCleanup({ config, store, tenantConfigStore, logger, dryRun: true });
    expect(dryRunResults.find((result) => result.tenantId === "alpha")?.deletedCount).toBe(1);
    expect(await store.getPack("old-alpha", "alpha")).toBeDefined();

    const results = await runRetentionCleanup({ config, store, tenantConfigStore, logger, dryRun: false });
    expect(results.find((result) => result.tenantId === "alpha")?.deletedCount).toBe(1);
    expect(results.find((result) => result.tenantId === "beta")?.deletedCount).toBe(0);
    expect(await store.getPack("old-alpha", "alpha")).toBeUndefined();
    expect(await store.getPack("old-beta", "beta")).toBeDefined();

    const auditEvents = await store.listAuditEvents({ action: "retention.cleanup", outcome: "success" });
    expect(auditEvents.some((event) => event.tenantId === "alpha" && event.metadata.retentionDays === 1)).toBe(true);
    expect(auditEvents.some((event) => event.tenantId === "beta" && event.metadata.retentionDays === 30)).toBe(true);
  });
});
