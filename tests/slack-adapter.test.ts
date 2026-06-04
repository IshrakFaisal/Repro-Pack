import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env";
import { SlackNotificationProvider } from "../src/providers/slack";
import type { ResolvedTenantConfig } from "../src/types/integrations";

const config: AppConfig = {
  port: 0,
  logLevel: "silent",
  fixtureRoot: "fixtures/cases",
  artifactOutputDir: "artifacts",
  dataRoot: "data",
  tenantConfigRoot: "tenants",
  storageDriver: "fs",
  sqliteDatabasePath: "data/repro-pack.sqlite",
  processTimeoutMs: 2500,
  httpTimeoutMs: 2000,
  llmTimeoutMs: 10000,
  maxProviderRetries: 0,
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
  apiKey: "test-key",
  baseUrl: "https://repro.example.test"
};

const tenant: ResolvedTenantConfig = {
  tenantId: "acme",
  name: "Acme Support",
  auth: { apiKeys: [] },
  providers: {
    slack: {
      enabled: true,
      webhookUrl: "https://hooks.slack.test/abc",
      channel: "#repro-approvals"
    }
  }
};

const logger = {
  info: vi.fn(),
  error: vi.fn()
};

describe("Slack notification provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it("posts an approval summary to the configured Slack webhook", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new SlackNotificationProvider(tenant, config, logger);
    await provider.postPackApproved({
      tenantId: "acme",
      tenantName: "Acme Support",
      ticketId: "zendesk-12345",
      confidence: 0.82,
      reviewer: "qa@example.test",
      packUrl: "https://repro.example.test/packs/zendesk-12345?tenantId=acme"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.test/abc",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" }
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { channel: string; text: string };
    expect(body.channel).toBe("#repro-approvals");
    expect(body.text).toContain("zendesk-12345");
    expect(body.text).toContain("Confidence: 0.82");
    expect(body.text).toContain("Reviewer: qa@example.test");
    expect(body.text).toContain("Tenant: Acme Support");
    expect(body.text).toContain("https://repro.example.test/packs/zendesk-12345?tenantId=acme");
  });
});
