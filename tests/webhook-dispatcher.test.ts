import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env";
import type { ResolvedTenantConfig } from "../src/types/integrations";
import { signWebhookPayload, WebhookDispatcher } from "../src/webhooks/dispatcher";
import type { PackWebhookEvent } from "../src/webhooks/events";

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
  maxProviderRetries: 1,
  queuePollMs: 10,
  queueLeaseMs: 1000,
  queueMaxAttempts: 3,
  retentionDays: 30,
  redactIps: true,
  redactDirectIdentifiers: true,
  appVersion: "test",
  buildHash: "test",
  apiKey: "test-key"
};

const tenant: ResolvedTenantConfig = {
  tenantId: "acme",
  name: "Acme",
  auth: { apiKeys: [] },
  providers: {
    webhook: {
      enabled: true,
      url: "https://hooks.example.test/repro",
      secret: "webhook-secret",
      events: ["pack.processed", "pack.approved", "pack.synced"]
    }
  }
};

const logger = {
  info: vi.fn(),
  error: vi.fn()
};

const event: PackWebhookEvent = {
  event: "pack.approved",
  tenantId: "acme",
  ticketId: "zendesk-12345",
  status: "approved",
  confidence: 0.82,
  timestamp: "2026-06-03T10:00:00.000Z"
};

describe("webhook dispatcher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it("signs outbound webhook payloads with HMAC-SHA256", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new WebhookDispatcher(config, logger).dispatch(tenant, event);

    const options = fetchMock.mock.calls[0]?.[1] as { body: string; headers: Record<string, string> };
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(options.headers["x-repro-signature"]).toBe(signWebhookPayload(options.body, "webhook-secret"));
    expect(JSON.parse(options.body)).toEqual(event);
  });

  it("retries retryable webhook failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new WebhookDispatcher(config, logger).dispatch(tenant, event);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: "webhook.dispatch.sent" }));
  });
});
