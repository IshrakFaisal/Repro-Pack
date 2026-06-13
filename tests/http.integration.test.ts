import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";

describe("http endpoints", () => {
  const originalEnv = { ...process.env };
  let dataRoot = "";
  let artifactRoot = "";
  let tenantRoot = "";

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-http-"));
    dataRoot = path.join(base, "data");
    artifactRoot = path.join(base, "artifacts");
    tenantRoot = path.join(base, "tenants");
    process.env.FIXTURE_ROOT = "fixtures/cases";
    process.env.ARTIFACT_OUTPUT_DIR = artifactRoot;
    process.env.DATA_ROOT = dataRoot;
    process.env.TENANT_CONFIG_ROOT = tenantRoot;
    process.env.LOG_LEVEL = "silent";
    process.env.API_KEY = "test-api-key";
    process.env.ALPHA_API_KEY = "alpha-key";
    process.env.BETA_API_KEY = "beta-key";
    process.env.QUEUE_MAX_ATTEMPTS = "3";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports health metadata without auth", async () => {
    const app = await createApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    const liveResponse = await app.inject({ method: "GET", url: "/health/live" });
    const readyResponse = await app.inject({ method: "GET", url: "/health/ready" });
    const metricsResponse = await app.inject({ method: "GET", url: "/metrics" });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok"
    });
    expect(liveResponse.statusCode).toBe(200);
    expect(readyResponse.statusCode).toBe(200);
    expect(metricsResponse.statusCode).toBe(200);
  });

  it("rejects protected routes without the configured API key", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/tickets/process",
      payload: {
        fixtureId: "backend-trace-correlation",
        dryRun: true
      }
    });
    await app.close();

    expect(response.statusCode).toBe(401);
  });

  it("returns sanitized validation errors", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers: { "x-api-key": "test-api-key" },
      payload: {
        dryRun: true
      }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "Invalid request payload",
      code: "validation_error"
    });
  });

  it("processes tickets, persists packs, supports review, and exports approved issues", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const processResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "backend-trace-correlation",
        dryRun: true
      }
    });

    const storedPackResponse = await app.inject({
      method: "GET",
      url: "/packs/backend-trace-correlation",
      headers
    });

    const reviewResponse = await app.inject({
      method: "POST",
      url: "/packs/backend-trace-correlation/review",
      headers,
      payload: {
        status: "approved",
        reviewer: "qa@example.test",
        note: "Evidence is sufficient."
      }
    });

    const exportResponse = await app.inject({
      method: "POST",
      url: "/issues/backend-trace-correlation/export",
      headers
    });

    const debugResponse = await app.inject({
      method: "GET",
      url: "/debug/ticket/heavy-sanitization-payload",
      headers
    });
    await app.close();

    expect(processResponse.statusCode).toBe(200);
    expect(processResponse.json().reviewStatus).toBe("draft");
    expect(storedPackResponse.statusCode).toBe(200);
    expect(storedPackResponse.json().ticketId).toBe("backend-trace-correlation");
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json().status).toBe("approved");
    expect(exportResponse.statusCode).toBe(200);
    const issuePath = exportResponse.json().issuePath as string;
    await expect(fs.readFile(issuePath, "utf8")).resolves.toContain("## Evidence and confidence");
    expect(debugResponse.statusCode).toBe(200);
    expect(JSON.stringify(debugResponse.json())).not.toContain("refund.user@example.test");
  });

  it("blocks tenant API keys from accessing another tenant scope", async () => {
    await writeTenantConfig(tenantRoot, "alpha", "ALPHA_API_KEY");
    await writeTenantConfig(tenantRoot, "beta", "BETA_API_KEY");
    const app = await createApp();
    const alphaHeaders = { "x-api-key": "alpha-key", "x-tenant-id": "alpha" };

    const processResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers: alphaHeaders,
      payload: {
        tenantId: "alpha",
        fixtureId: "backend-trace-correlation",
        dryRun: true
      }
    });

    const ownPackResponse = await app.inject({
      method: "GET",
      url: "/packs/backend-trace-correlation?tenantId=alpha",
      headers: alphaHeaders
    });

    const crossPackResponse = await app.inject({
      method: "GET",
      url: "/packs/backend-trace-correlation?tenantId=beta",
      headers: alphaHeaders
    });

    const crossListResponse = await app.inject({
      method: "GET",
      url: "/jobs?tenantId=beta",
      headers: alphaHeaders
    });

    const ownAuditResponse = await app.inject({
      method: "GET",
      url: "/audit-events?tenantId=alpha&action=ticket.processed",
      headers: alphaHeaders
    });

    const crossAuditResponse = await app.inject({
      method: "GET",
      url: "/audit-events?tenantId=beta",
      headers: alphaHeaders
    });

    const crossReviewResponse = await app.inject({
      method: "POST",
      url: "/packs/backend-trace-correlation/review",
      headers: alphaHeaders,
      payload: {
        tenantId: "beta",
        status: "approved"
      }
    });

    const globalPackResponse = await app.inject({
      method: "GET",
      url: "/packs/backend-trace-correlation?tenantId=alpha",
      headers: { "x-api-key": "test-api-key" }
    });
    await app.close();

    expect(processResponse.statusCode).toBe(200);
    expect(ownPackResponse.statusCode).toBe(200);
    expect(crossPackResponse.statusCode).toBe(403);
    expect(crossListResponse.statusCode).toBe(403);
    expect(ownAuditResponse.statusCode).toBe(200);
    expect(ownAuditResponse.json().every((event: { tenantId: string; action: string }) => event.tenantId === "alpha" && event.action === "ticket.processed")).toBe(true);
    expect(crossAuditResponse.statusCode).toBe(403);
    expect(crossReviewResponse.statusCode).toBe(403);
    expect(globalPackResponse.statusCode).toBe(200);
  });

  it("supports async processing with a persisted job record", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const enqueueResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "feature-flag-regression",
        dryRun: true,
        async: true
      }
    });

    expect(enqueueResponse.statusCode).toBe(202);
    const jobId = enqueueResponse.json().jobId as string;

    let status = "queued";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const jobResponse = await app.inject({
        method: "GET",
        url: `/jobs/${jobId}`,
        headers
      });
      status = jobResponse.json().status;
      if (status === "succeeded") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const packListResponse = await app.inject({
      method: "GET",
      url: "/packs",
      headers
    });
    await app.close();

    expect(status).toBe("succeeded");
    expect(packListResponse.statusCode).toBe(200);
    expect(packListResponse.json().some((item: { ticketId: string }) => item.ticketId === "feature-flag-regression")).toBe(
      true
    );
  });

  it("batch processes tickets and returns triage recommendations", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const batchResponse = await app.inject({
      method: "POST",
      url: "/tickets/batch-process",
      headers,
      payload: {
        dryRun: true,
        items: [
          { fixtureId: "backend-trace-correlation" },
          { fixtureId: "feature-flag-regression" },
          { fixtureId: "missing-fixture" }
        ]
      }
    });

    const triageResponse = await app.inject({
      method: "GET",
      url: "/triage/recommendations?status=draft&limit=2",
      headers
    });

    const packsResponse = await app.inject({
      method: "GET",
      url: "/packs?sort=ticketId&direction=asc",
      headers
    });
    const compareResponse = await app.inject({
      method: "GET",
      url: "/packs/backend-trace-correlation/compare/feature-flag-regression",
      headers
    });
    await app.close();

    expect(batchResponse.statusCode).toBe(200);
    expect(batchResponse.json().results).toHaveLength(3);
    expect(batchResponse.json().results.filter((result: { status: string }) => result.status === "processed")).toHaveLength(2);
    expect(batchResponse.json().results.filter((result: { status: string }) => result.status === "error")).toHaveLength(1);
    expect(packsResponse.json().map((pack: { ticketId: string }) => pack.ticketId)).toEqual([
      "backend-trace-correlation",
      "feature-flag-regression"
    ]);
    expect(triageResponse.statusCode).toBe(200);
    expect(triageResponse.json()).toHaveLength(2);
    expect(triageResponse.json()[0]).toMatchObject({
      ticketId: expect.any(String),
      score: expect.any(Number),
      reasons: expect.any(Array)
    });
    expect(compareResponse.statusCode).toBe(200);
    expect(compareResponse.json()).toMatchObject({
      left: { ticketId: "backend-trace-correlation" },
      right: { ticketId: "feature-flag-regression" },
      duplicateLikelihood: expect.any(Number),
      recommendation: expect.any(String),
      stepOverlap: {
        sharedStepCount: expect.any(Number)
      }
    });
  });

  it("lists jobs with status filters and safely retries failed jobs", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const enqueueResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "missing-fixture",
        dryRun: true,
        async: true
      }
    });

    expect(enqueueResponse.statusCode).toBe(202);
    const jobId = enqueueResponse.json().jobId as string;
    const firstFailure = await waitForJobStatus(app, jobId, "failed", headers);

    const filteredResponse = await app.inject({
      method: "GET",
      url: "/jobs?status=failed",
      headers
    });

    const retryResponse = await app.inject({
      method: "POST",
      url: `/jobs/${jobId}/retry`,
      headers
    });

    const secondFailure = await waitForJobStatus(app, jobId, "failed", headers);
    await app.close();

    expect(firstFailure.attempts).toBe(1);
    expect(filteredResponse.statusCode).toBe(200);
    expect(filteredResponse.json().some((item: { jobId: string }) => item.jobId === jobId)).toBe(true);
    expect(retryResponse.statusCode).toBe(202);
    expect(retryResponse.json().status).toBe("queued");
    expect(secondFailure.attempts).toBe(2);
  });

  it("dead-letters jobs after the final failed attempt and rejects retry", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const enqueueResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "missing-fixture",
        dryRun: true,
        async: true,
        maxAttempts: 1
      }
    });

    expect(enqueueResponse.statusCode).toBe(202);
    const jobId = enqueueResponse.json().jobId as string;
    const deadLettered = await waitForJobStatus(app, jobId, "dead_lettered", headers);

    const retryResponse = await app.inject({
      method: "POST",
      url: `/jobs/${jobId}/retry`,
      headers
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: `/audit-events?action=job.dead_lettered`,
      headers
    });
    await app.close();

    expect(deadLettered).toMatchObject({
      status: "dead_lettered",
      attempts: 1,
      maxAttempts: 1
    });
    expect(deadLettered.deadLetteredAt).toBeTruthy();
    expect(retryResponse.statusCode).toBe(400);
    expect(retryResponse.json()).toMatchObject({ code: "invalid_job_state" });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json().some((event: { metadata: { jobId?: string } }) => event.metadata.jobId === jobId)).toBe(true);
  });

  it("filters pack summaries and includes review history metadata", async () => {
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "backend-trace-correlation",
        dryRun: true
      }
    });

    await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        fixtureId: "feature-flag-regression",
        dryRun: true
      }
    });

    await app.inject({
      method: "POST",
      url: "/packs/backend-trace-correlation/review",
      headers,
      payload: {
        status: "approved",
        reviewer: "qa@example.test"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/packs?status=approved&limit=1&offset=0",
      headers
    });

    const searchResponse = await app.inject({
      method: "GET",
      url: "/packs?search=feature&sort=ticketId&direction=asc",
      headers
    });

    const sortedResponse = await app.inject({
      method: "GET",
      url: "/packs?sort=ticketId&direction=asc&limit=2",
      headers
    });
    const analyticsResponse = await app.inject({
      method: "GET",
      url: "/analytics/summary",
      headers
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0]).toMatchObject({
      ticketId: "backend-trace-correlation",
      status: "approved",
      reviewHistoryCount: 1,
      lastReview: {
        status: "approved",
        reviewer: "qa@example.test"
      }
    });
    expect(searchResponse.statusCode).toBe(200);
    expect(searchResponse.json().map((pack: { ticketId: string }) => pack.ticketId)).toEqual(["feature-flag-regression"]);
    expect(sortedResponse.statusCode).toBe(200);
    expect(sortedResponse.json().map((pack: { ticketId: string }) => pack.ticketId)).toEqual([
      "backend-trace-correlation",
      "feature-flag-regression"
    ]);
    expect(sortedResponse.json()[0].providerStatus).toMatchObject({
      session: expect.any(String),
      logs: expect.any(String),
      featureFlags: expect.any(String),
      release: expect.any(String)
    });
    expect(analyticsResponse.statusCode).toBe(200);
    expect(analyticsResponse.json()).toMatchObject({
      packCount: 2,
      customerImpact: {
        averageScore: expect.any(Number),
        topPacks: expect.any(Array)
      },
      supportToCloseCycle: {
        closedPackCount: 1
      }
    });
    expect(analyticsResponse.json().confidenceTrend.length).toBeGreaterThan(0);
    expect(analyticsResponse.json().featureFlagCorrelation.length).toBeGreaterThan(0);
  });
});

async function writeTenantConfig(rootDir: string, tenantId: string, envName: string): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
  await fs.writeFile(
    path.join(rootDir, `${tenantId}.json`),
    JSON.stringify(
      {
        tenantId,
        name: `${tenantId} tenant`,
        auth: {
          apiKeys: [
            {
              keyId: `${tenantId}-key`,
              actorId: `${tenantId}-actor`,
              secret: {
                provider: "env",
                env: envName
              },
              roles: ["read", "process", "review", "sync"]
            }
          ]
        },
        providers: {}
      },
      null,
      2
    )
  );
}

async function waitForJobStatus(
  app: Awaited<ReturnType<typeof createApp>>,
  jobId: string,
  expectedStatus: string,
  headers: Record<string, string>
): Promise<{ status: string; attempts: number; maxAttempts: number; deadLetteredAt?: string }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/jobs/${jobId}`,
      headers
    });
    const job = response.json() as { status: string; attempts: number; maxAttempts: number; deadLetteredAt?: string };
    if (job.status === expectedStatus) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Job ${jobId} did not reach ${expectedStatus}`);
}
