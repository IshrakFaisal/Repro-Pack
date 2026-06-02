import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { AppConfig } from "../config/env";
import type { IssueLink, IssueTarget, ResolvedTenantConfig } from "../types/integrations";
import {
  FeatureFlagContextSchema,
  LogsContextSchema,
  ReleaseInfoSchema,
  SessionContextSchema,
  type FeatureFlagContext,
  type IssueDraft,
  type LogsContext,
  type ProviderResultOf,
  type ReleaseInfo,
  type SessionContext,
  type SupportTicket
} from "../types/schemas";
import { normalizeSupportTicket } from "../ingestion/ticket-ingestion";
import { HttpJsonClient } from "./http-client";
import type {
  FeatureFlagProvider,
  IssueTrackerProvider,
  LogsProvider,
  ReleaseProvider,
  SessionProvider,
  SupportProvider,
  TicketLookup
} from "./interfaces";

function nowIso(): string {
  return new Date().toISOString();
}

function buildAuthHeaders(input: {
  bearerToken?: string;
  authHeaderName?: string;
  basicEmail?: string;
  basicToken?: string;
}): Record<string, string> {
  if (input.bearerToken) {
    return {
      [input.authHeaderName ?? "authorization"]: `Bearer ${input.bearerToken}`
    };
  }

  if (input.basicEmail && input.basicToken) {
    const encoded = Buffer.from(`${input.basicEmail}:${input.basicToken}`).toString("base64");
    return {
      authorization: `Basic ${encoded}`
    };
  }

  return {};
}

function unwrapProviderPayload<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: T }).data;
  }

  return value as T;
}

async function withProviderResult<T>(
  provider: string,
  loader: () => Promise<T>
): Promise<ProviderResultOf<T>> {
  const startedAt = Date.now();

  try {
    const data = await loader();
    return {
      provider,
      status: "success",
      fetchedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      data
    };
  } catch (error) {
    return {
      provider,
      status: "error",
      fetchedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      errorSummary: error instanceof Error ? error.message : "Unknown provider error"
    };
  }
}

function appendQueryParams(url: URL, ticket: SupportTicket): URL {
  url.searchParams.set("ticketId", ticket.ticketId);
  if (ticket.userId) {
    url.searchParams.set("userId", ticket.userId);
  }
  if (ticket.accountId) {
    url.searchParams.set("accountId", ticket.accountId);
  }
  if (ticket.workspaceId) {
    url.searchParams.set("workspaceId", ticket.workspaceId);
  }
  return url;
}

export class ZendeskSupportProvider implements SupportProvider {
  name = "zendesk-support";

  constructor(
    private readonly tenant: ResolvedTenantConfig,
    private readonly client: HttpJsonClient
  ) {}

  async loadTicket(lookup: TicketLookup): Promise<SupportTicket> {
    if (!("supportTicketId" in lookup)) {
      throw new Error("Zendesk support provider requires supportTicketId lookup");
    }

    const config = this.tenant.providers.support;
    if (!config) {
      throw new Error(`Zendesk provider not configured for tenant ${this.tenant.tenantId}`);
    }

    const headers = buildAuthHeaders({
      bearerToken: config.bearerToken,
      basicEmail: `${config.email ?? ""}/token`,
      basicToken: config.apiToken
    });
    const response = await this.client.request<{ ticket: unknown }>(
      `${config.baseUrl.replace(/\/$/, "")}/api/v2/tickets/${lookup.supportTicketId}.json`,
      { headers }
    );

    const rawTicket = response.data.ticket;
    return normalizeSupportTicket({
      ticketId: `zendesk-${lookup.supportTicketId}`,
      complaintText:
        (rawTicket as Record<string, unknown>).description ??
        (rawTicket as Record<string, unknown>).subject ??
        "not available",
      userId: (rawTicket as Record<string, unknown>).requester_id?.toString(),
      accountId: (rawTicket as Record<string, unknown>).organization_id?.toString(),
      workspaceId: (rawTicket as Record<string, unknown>).group_id?.toString(),
      severity: (rawTicket as Record<string, unknown>).priority?.toString(),
      priority: (rawTicket as Record<string, unknown>).priority?.toString(),
      timestamps: {
        createdAt: (rawTicket as Record<string, unknown>).created_at?.toString(),
        updatedAt: (rawTicket as Record<string, unknown>).updated_at?.toString()
      },
      supportAgentNotes: Array.isArray((rawTicket as Record<string, unknown>).tags)
        ? ((rawTicket as Record<string, unknown>).tags as unknown[]).map((entry) => String(entry))
        : [],
      source: {
        platform: "zendesk",
        externalId: lookup.supportTicketId
      },
      rawSource: rawTicket as Record<string, unknown>
    });
  }
}

abstract class BaseHttpContextProvider<T> {
  constructor(
    readonly name: string,
    protected readonly tenant: ResolvedTenantConfig,
    private readonly client: HttpJsonClient
  ) {}

  protected abstract getProviderConfig():
    | ResolvedTenantConfig["providers"]["logs"]
    | ResolvedTenantConfig["providers"]["session"]
    | ResolvedTenantConfig["providers"]["featureFlags"]
    | ResolvedTenantConfig["providers"]["release"];

  protected abstract parse(raw: unknown): T;

  async fetch(ticket: SupportTicket): Promise<ProviderResultOf<T>> {
    return withProviderResult(this.name, async () => {
      const config = this.getProviderConfig();
      if (!config) {
        throw new Error(`Provider ${this.name} not configured for tenant ${this.tenant.tenantId}`);
      }

      const base = new URL(config.path, config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
      const url = appendQueryParams(base, ticket);
      const response = await this.client.request<unknown>(url.toString(), {
        headers: {
          ...config.extraHeaders,
          ...buildAuthHeaders({
            bearerToken: config.token,
            authHeaderName: config.authHeaderName
          })
        }
      });

      return this.parse(unwrapProviderPayload<unknown>(response.data));
    });
  }
}

export class HttpLogsProvider extends BaseHttpContextProvider<LogsContext> implements LogsProvider {
  constructor(tenant: ResolvedTenantConfig, client: HttpJsonClient) {
    super("http-logs", tenant, client);
  }

  protected getProviderConfig() {
    return this.tenant.providers.logs;
  }

  protected parse(raw: unknown): LogsContext {
    return LogsContextSchema.parse(raw);
  }
}

export class HttpSessionProvider extends BaseHttpContextProvider<SessionContext> implements SessionProvider {
  constructor(tenant: ResolvedTenantConfig, client: HttpJsonClient) {
    super("http-session", tenant, client);
  }

  protected getProviderConfig() {
    return this.tenant.providers.session;
  }

  protected parse(raw: unknown): SessionContext {
    return SessionContextSchema.parse(raw);
  }
}

export class HttpFeatureFlagProvider
  extends BaseHttpContextProvider<FeatureFlagContext>
  implements FeatureFlagProvider
{
  constructor(tenant: ResolvedTenantConfig, client: HttpJsonClient) {
    super("http-flags", tenant, client);
  }

  protected getProviderConfig() {
    return this.tenant.providers.featureFlags;
  }

  protected parse(raw: unknown): FeatureFlagContext {
    return FeatureFlagContextSchema.parse(raw);
  }
}

export class HttpReleaseProvider extends BaseHttpContextProvider<ReleaseInfo> implements ReleaseProvider {
  constructor(tenant: ResolvedTenantConfig, client: HttpJsonClient) {
    super("http-release", tenant, client);
  }

  protected getProviderConfig() {
    return this.tenant.providers.release;
  }

  protected parse(raw: unknown): ReleaseInfo {
    return ReleaseInfoSchema.parse(raw);
  }
}

function buildMarker(target: IssueTarget, tenantId: string, ticketId: string): string {
  return `repro-pack:${target}:${tenantId}:${ticketId}`;
}

function buildIssueBody(issueDraft: IssueDraft, marker: string): string {
  return `${issueDraft.body}\n\n<!-- ${marker} -->\n`;
}

export class GitHubIssueTracker implements IssueTrackerProvider {
  readonly name = "github-issues";
  readonly target = "github" as const;

  constructor(
    private readonly tenant: ResolvedTenantConfig,
    private readonly client: HttpJsonClient
  ) {}

  private headers(): Record<string, string> {
    const config = this.tenant.providers.github;
    if (!config) {
      throw new Error(`GitHub provider not configured for tenant ${this.tenant.tenantId}`);
    }

    return {
      authorization: `Bearer ${config.token}`,
      accept: "application/vnd.github+json"
    };
  }

  async sync(input: {
    tenantId: string;
    ticket: SupportTicket;
    issueDraft: IssueDraft;
    existingLink?: IssueLink;
    dryRun: boolean;
  }): Promise<IssueLink> {
    const config = this.tenant.providers.github;
    if (!config) {
      throw new Error(`GitHub provider not configured for tenant ${this.tenant.tenantId}`);
    }

    const marker = buildMarker(this.target, input.tenantId, input.ticket.ticketId);
    const externalKey = `${config.owner}/${config.repo}#${marker}`;
    const body = buildIssueBody(input.issueDraft, marker);
    const idempotencyKey = `github:${input.tenantId}:${input.ticket.ticketId}`;

    if (input.dryRun) {
      return {
        target: this.target,
        externalId: input.existingLink?.externalId ?? "preview",
        externalKey,
        status: "preview",
        syncedAt: nowIso(),
        idempotencyKey
      };
    }

    const listUrl = `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues?state=all`;
    const existingIssues = await this.client.request<Array<{ number: number; html_url?: string; body?: string }>>(listUrl, {
      headers: this.headers()
    });
    const match =
      input.existingLink?.externalId !== undefined
        ? existingIssues.data.find((issue) => String(issue.number) === input.existingLink?.externalId)
        : existingIssues.data.find((issue) => issue.body?.includes(marker));

    if (match) {
      const updateUrl = `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues/${match.number}`;
      await this.client.request(updateUrl, {
        method: "PATCH",
        headers: this.headers(),
        body: {
          title: input.issueDraft.title,
          body,
          labels: config.labels
        }
      });
      return {
        target: this.target,
        externalId: String(match.number),
        externalKey,
        url: match.html_url,
        status: "updated",
        syncedAt: nowIso(),
        idempotencyKey
      };
    }

    const createUrl = `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues`;
    const created = await this.client.request<{ number: number; html_url?: string }>(createUrl, {
      method: "POST",
      headers: this.headers(),
      body: {
        title: input.issueDraft.title,
        body,
        labels: config.labels
      }
    });

    return {
      target: this.target,
      externalId: String(created.data.number),
      externalKey,
      url: created.data.html_url,
      status: "created",
      syncedAt: nowIso(),
      idempotencyKey
    };
  }
}

export class JiraIssueTracker implements IssueTrackerProvider {
  readonly name = "jira-issues";
  readonly target = "jira" as const;

  constructor(
    private readonly tenant: ResolvedTenantConfig,
    private readonly client: HttpJsonClient
  ) {}

  private headers(): Record<string, string> {
    const config = this.tenant.providers.jira;
    if (!config) {
      throw new Error(`Jira provider not configured for tenant ${this.tenant.tenantId}`);
    }

    return buildAuthHeaders({
      bearerToken: config.bearerToken,
      basicEmail: config.email,
      basicToken: config.apiToken
    });
  }

  async sync(input: {
    tenantId: string;
    ticket: SupportTicket;
    issueDraft: IssueDraft;
    existingLink?: IssueLink;
    dryRun: boolean;
  }): Promise<IssueLink> {
    const config = this.tenant.providers.jira;
    if (!config) {
      throw new Error(`Jira provider not configured for tenant ${this.tenant.tenantId}`);
    }

    const marker = buildMarker(this.target, input.tenantId, input.ticket.ticketId);
    const externalKey = `${config.projectKey}:${marker}`;
    const idempotencyKey = `jira:${input.tenantId}:${input.ticket.ticketId}`;

    if (input.dryRun) {
      return {
        target: this.target,
        externalId: input.existingLink?.externalId ?? "preview",
        externalKey,
        status: "preview",
        syncedAt: nowIso(),
        idempotencyKey
      };
    }

    const searchUrl = `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/search`;
    const search = await this.client.request<{ issues?: Array<{ id: string; key: string; self?: string; fields?: { description?: string } }> }>(
      searchUrl,
      {
        method: "POST",
        headers: this.headers(),
        body: {
          jql: `project = ${config.projectKey}`,
          maxResults: 50
        }
      }
    );
    const existingIssues = search.data.issues ?? [];
    const match =
      input.existingLink?.externalId !== undefined
        ? existingIssues.find((issue) => issue.id === input.existingLink?.externalId || issue.key === input.existingLink?.externalId)
        : existingIssues.find((issue) => issue.fields?.description?.includes(marker));

    const description = `${input.issueDraft.body}\n\n${marker}`;

    if (match) {
      const updateUrl = `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${match.id}`;
      await this.client.request(updateUrl, {
        method: "PUT",
        headers: this.headers(),
        body: {
          fields: {
            summary: input.issueDraft.title,
            description,
            labels: config.labels
          }
        }
      });
      return {
        target: this.target,
        externalId: match.id,
        externalKey,
        url: match.self,
        status: "updated",
        syncedAt: nowIso(),
        idempotencyKey
      };
    }

    const createUrl = `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/issue`;
    const created = await this.client.request<{ id: string; key: string; self?: string }>(createUrl, {
      method: "POST",
      headers: this.headers(),
      body: {
        fields: {
          project: { key: config.projectKey },
          summary: input.issueDraft.title,
          description,
          issuetype: { name: config.issueType },
          labels: config.labels
        }
      }
    });

    return {
      target: this.target,
      externalId: created.data.id,
      externalKey,
      url: created.data.self,
      status: "created",
      syncedAt: nowIso(),
      idempotencyKey
    };
  }
}

export function createHttpClient(config: AppConfig) {
  return new HttpJsonClient(config);
}
