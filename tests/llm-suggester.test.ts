import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config/env";
import { suggestLlmReproSteps } from "../src/llm/suggester";
import type { ResolvedTenantConfig } from "../src/types/integrations";
import type { EvidenceItem, ReproStep } from "../src/types/schemas";

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
  llm: {
    enabled: true,
    model: "claude-sonnet-4-20250514",
    apiKey: "anthropic-key"
  },
  auth: { apiKeys: [] },
  providers: {}
};

const reproSteps: ReproStep[] = [
  { step: "Open /checkout as user alice@example.test.", source: "user_report", confidence: 0.76 }
];

const evidence: EvidenceItem[] = [
  {
    type: "network",
    source: "session-network",
    summary: "POST /api/payments",
    detail: "Observed 500",
    confidence: 0.93,
    citation: "network:req-1",
    relatedIds: [],
    conflict: false
  }
];

const logger = {
  info: vi.fn(),
  error: vi.fn()
};

describe("LLM repro step suggester", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    logger.info.mockClear();
    logger.error.mockClear();
  });

  it("returns parsed suggestions from Anthropic using sanitized prompt input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify({ steps: ["Retry checkout with the captured feature flag state."] }) }]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await suggestLlmReproSteps({
      tenant,
      config,
      logger,
      summary: "Checkout fails for alice@example.test",
      reproSteps,
      evidence
    });

    expect(result?.steps).toEqual(["Retry checkout with the captured feature flag state."]);
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { messages: Array<{ content: string }> };
    expect(body.messages[0]?.content).toContain("[REDACTED:EMAIL]");
    expect(body.messages[0]?.content).not.toContain("alice@example.test");
  });

  it("returns null and logs when the LLM call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await suggestLlmReproSteps({
      tenant,
      config,
      logger,
      summary: "Checkout fails",
      reproSteps,
      evidence
    });

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ event: "llm.suggestion.failed", tenantId: "acme" }));
  });
});
