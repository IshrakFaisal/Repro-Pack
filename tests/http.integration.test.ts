import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";

describe("http endpoints", () => {
  const originalEnv = { ...process.env };
  let dataRoot = "";
  let artifactRoot = "";

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-http-"));
    dataRoot = path.join(base, "data");
    artifactRoot = path.join(base, "artifacts");
    process.env.FIXTURE_ROOT = "fixtures/cases";
    process.env.ARTIFACT_OUTPUT_DIR = artifactRoot;
    process.env.DATA_ROOT = dataRoot;
    process.env.LOG_LEVEL = "silent";
    process.env.API_KEY = "test-api-key";
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
});
