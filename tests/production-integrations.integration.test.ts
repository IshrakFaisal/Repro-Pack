import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";

type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  html_url: string;
};

type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    description: unknown;
    labels: string[];
  };
};

type MockServerState = Awaited<ReturnType<typeof startMockServer>>["state"];

function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      resolve(body ? JSON.parse(body) : {});
    });
    request.on("error", reject);
  });
}

async function startMockServer() {
  let logsAttempts = 0;
  let githubCreateCount = 0;
  let githubUpdateCount = 0;
  let jiraCreateCount = 0;
  let jiraUpdateCount = 0;
  const githubIssues: GitHubIssue[] = [];
  const jiraIssues: JiraIssue[] = [];

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/api/v2/tickets/123.json") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ticket: {
            id: 123,
            subject: "Checkout fails for Acme workspace",
            description: "Customer cannot complete checkout after clicking Submit.",
            requester_id: "user-zd-1",
            organization_id: "acct-zd-1",
            group_id: "ws-zd-1",
            priority: "high",
            created_at: "2026-06-02T06:00:00.000Z",
            updated_at: "2026-06-02T06:05:00.000Z",
            tags: ["payments", "checkout"]
          }
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/logs") {
      logsAttempts += 1;
      if (logsAttempts === 1) {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
        response.end(JSON.stringify({ error: "rate_limited" }));
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          entries: [
            {
              timestamp: "2026-06-02T06:01:02.000Z",
              level: "error",
              source: "checkout-api",
              message: "Checkout transaction failed",
              requestId: "req-acme-1",
              traceId: "trace-acme-1",
              errorCode: "CHK-500",
              metadata: {}
            }
          ],
          recentErrors: [],
          samplePayload: {
            customerEmail: "billing.user@example.test",
            amount: 42
          }
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/session") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          sessionId: "sess-acme-1",
          browser: "Chrome",
          browserVersion: "126.0.0.0",
          device: "Desktop",
          os: "Windows 11",
          events: [
            {
              timestamp: "2026-06-02T06:00:55.000Z",
              type: "page_view",
              detail: "Opened checkout",
              route: "/checkout"
            },
            {
              timestamp: "2026-06-02T06:01:01.000Z",
              type: "click",
              detail: "Submit checkout",
              route: "/checkout"
            }
          ],
          network: [
            {
              timestamp: "2026-06-02T06:01:02.000Z",
              method: "POST",
              url: "/api/checkout",
              status: 500,
              requestId: "req-acme-1",
              traceId: "trace-acme-1",
              responseSummary: "500 Internal Server Error returned by checkout API"
            }
          ]
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/flags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          flags: [
            {
              name: "checkout_rewrite",
              variant: "enabled",
              source: "launch-control",
              reason: "Workspace in rollout cohort"
            }
          ]
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/release") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          appVersion: "2026.06.02-web",
          buildHash: "build-acme-123",
          releaseIdentifier: "release-2026-06-02.1",
          deployedAt: "2026-06-02T04:00:00.000Z",
          source: "deploy-system"
        })
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/repos/acme/repro/issues") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(githubIssues));
      return;
    }

    if (request.method === "POST" && url.pathname === "/repos/acme/repro/issues") {
      const body = (await readJsonBody(request)) as { title: string; body: string };
      githubCreateCount += 1;
      const issue: GitHubIssue = {
        number: githubIssues.length + 1,
        title: body.title,
        body: body.body,
        html_url: `https://github.example/issues/${githubIssues.length + 1}`
      };
      githubIssues.push(issue);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(issue));
      return;
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/repos/acme/repro/issues/")) {
      const number = Number(url.pathname.split("/").pop());
      const body = (await readJsonBody(request)) as { title: string; body: string };
      githubUpdateCount += 1;
      const issue = githubIssues.find((entry) => entry.number === number);
      if (issue) {
        issue.title = body.title;
        issue.body = body.body;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(issue));
      return;
    }

    if (request.method === "POST" && url.pathname === "/rest/api/3/search") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ issues: jiraIssues }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/rest/api/3/issue") {
      const body = (await readJsonBody(request)) as { fields: JiraIssue["fields"] };
      jiraCreateCount += 1;
      const issue: JiraIssue = {
        id: String(jiraIssues.length + 1),
        key: `RP-${jiraIssues.length + 1}`,
        self: `https://jira.example/browse/RP-${jiraIssues.length + 1}`,
        fields: body.fields
      };
      jiraIssues.push(issue);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify(issue));
      return;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/rest/api/3/issue/")) {
      const id = url.pathname.split("/").pop() ?? "";
      const body = (await readJsonBody(request)) as { fields: JiraIssue["fields"] };
      jiraUpdateCount += 1;
      const issue = jiraIssues.find((entry) => entry.id === id || entry.key === id);
      if (issue) {
        issue.fields = body.fields;
      }
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found", path: url.pathname }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve mock server address");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    state: {
      get logsAttempts() {
        return logsAttempts;
      },
      get githubCreateCount() {
        return githubCreateCount;
      },
      get githubUpdateCount() {
        return githubUpdateCount;
      },
      get jiraCreateCount() {
        return jiraCreateCount;
      },
      get jiraUpdateCount() {
        return jiraUpdateCount;
      },
      githubIssues,
      jiraIssues
    }
  };
}

describe("production integration workflow", () => {
  const originalEnv = { ...process.env };
  let server: http.Server | undefined;
  let dataRoot = "";
  let artifactRoot = "";

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-prod-"));
    dataRoot = path.join(base, "data");
    artifactRoot = path.join(base, "artifacts");
    const tenantRoot = path.join(base, "tenants");
    await fs.mkdir(tenantRoot, { recursive: true });

    const mock = await startMockServer();
    server = mock.server;

    process.env.ARTIFACT_OUTPUT_DIR = artifactRoot;
    process.env.DATA_ROOT = dataRoot;
    process.env.TENANT_CONFIG_ROOT = tenantRoot;
    process.env.LOG_LEVEL = "silent";
    process.env.API_KEY = "test-api-key";
    process.env.TEST_ZENDESK_EMAIL = "zendesk@example.test";
    process.env.TEST_ZENDESK_TOKEN = "zd-token";
    process.env.TEST_CONTEXT_TOKEN = "context-token";
    process.env.TEST_GITHUB_TOKEN = "github-token";
    process.env.TEST_JIRA_EMAIL = "jira@example.test";
    process.env.TEST_JIRA_TOKEN = "jira-token";

    await fs.writeFile(
      path.join(tenantRoot, "acme.json"),
      JSON.stringify(
        {
          tenantId: "acme",
          name: "Acme Inc",
          providers: {
            support: {
              type: "zendesk",
              baseUrl: mock.baseUrl,
              email: { env: "TEST_ZENDESK_EMAIL" },
              apiToken: { env: "TEST_ZENDESK_TOKEN" }
            },
            logs: {
              type: "http-logs",
              baseUrl: mock.baseUrl,
              path: "/logs",
              bearerToken: { env: "TEST_CONTEXT_TOKEN" }
            },
            session: {
              type: "http-session",
              baseUrl: mock.baseUrl,
              path: "/session",
              bearerToken: { env: "TEST_CONTEXT_TOKEN" }
            },
            featureFlags: {
              type: "http-flags",
              baseUrl: mock.baseUrl,
              path: "/flags"
            },
            release: {
              type: "http-release",
              baseUrl: mock.baseUrl,
              path: "/release"
            },
            github: {
              type: "github",
              baseUrl: mock.baseUrl,
              owner: "acme",
              repo: "repro",
              token: { env: "TEST_GITHUB_TOKEN" }
            },
            jira: {
              type: "jira",
              baseUrl: mock.baseUrl,
              projectKey: "RP",
              issueType: "Bug",
              email: { env: "TEST_JIRA_EMAIL" },
              apiToken: { env: "TEST_JIRA_TOKEN" }
            }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    (globalThis as typeof globalThis & { __mockState?: MockServerState }).__mockState = mock.state;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (server) {
      await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("processes Zendesk tickets with real provider adapters, retries rate limits, and syncs issues idempotently", async () => {
    const mockState = (globalThis as typeof globalThis & { __mockState: MockServerState }).__mockState;
    const app = await createApp();
    const headers = { "x-api-key": "test-api-key" };

    const processResponse = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers,
      payload: {
        tenantId: "acme",
        supportTicketId: "123",
        dryRun: true
      }
    });

    expect(processResponse.statusCode).toBe(200);
    expect(processResponse.json().tenantId).toBe("acme");
    expect(processResponse.json().reproPack.ticketId).toBe("zendesk-123");
    expect(processResponse.json().reproPack.logs[0].errorCode).toBe("CHK-500");
    expect(mockState.logsAttempts).toBe(2);

    const previewSync = await app.inject({
      method: "POST",
      url: "/packs/zendesk-123/sync-issues",
      headers,
      payload: {
        tenantId: "acme",
        dryRun: true,
        targets: ["github", "jira"]
      }
    });
    expect(previewSync.statusCode).toBe(200);
    expect(previewSync.json().results.every((entry: { status: string }) => entry.status === "preview")).toBe(true);
    expect(mockState.githubCreateCount).toBe(0);
    expect(mockState.jiraCreateCount).toBe(0);

    const reviewResponse = await app.inject({
      method: "POST",
      url: "/packs/zendesk-123/review",
      headers,
      payload: {
        tenantId: "acme",
        status: "approved",
        reviewer: "owner@example.test",
        note: "Looks good"
      }
    });
    expect(reviewResponse.statusCode).toBe(200);

    const syncResponse = await app.inject({
      method: "POST",
      url: "/packs/zendesk-123/sync-issues",
      headers,
      payload: {
        tenantId: "acme",
        dryRun: false,
        targets: ["github", "jira"]
      }
    });
    expect(syncResponse.statusCode).toBe(200);
    expect(mockState.githubCreateCount).toBe(1);
    expect(mockState.jiraCreateCount).toBe(1);

    const repeatSyncResponse = await app.inject({
      method: "POST",
      url: "/packs/zendesk-123/sync-issues",
      headers,
      payload: {
        tenantId: "acme",
        dryRun: false,
        targets: ["github", "jira"]
      }
    });
    expect(repeatSyncResponse.statusCode).toBe(200);
    expect(mockState.githubCreateCount).toBe(1);
    expect(mockState.jiraCreateCount).toBe(1);
    expect(mockState.githubUpdateCount).toBe(1);
    expect(mockState.jiraUpdateCount).toBe(1);

    const packResponse = await app.inject({
      method: "GET",
      url: "/packs/zendesk-123?tenantId=acme",
      headers
    });
    await app.close();

    expect(packResponse.statusCode).toBe(200);
    expect(packResponse.json().issueLinks).toHaveLength(2);
    expect(mockState.githubIssues[0]?.body).not.toContain("context-token");
    expect(JSON.stringify(mockState.jiraIssues[0]?.fields.description)).toContain("repro-pack:jira:acme:zendesk-123");
  });

  it("returns a clean failure when a tenant config is missing", async () => {
    const app = await createApp();
    const response = await app.inject({
      method: "POST",
      url: "/tickets/process",
      headers: { "x-api-key": "test-api-key" },
      payload: {
        tenantId: "missing-tenant",
        supportTicketId: "123",
        dryRun: true
      }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Tenant config not found");
  });
});
