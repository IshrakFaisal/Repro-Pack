import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import type { AppConfig } from "../config/env";
import type { MetricsRegistry } from "../observability/metrics";
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

async function optionalRequest<T>(loader: () => Promise<{ data: T }>, fallback: T): Promise<T> {
  try {
    return (await loader()).data;
  } catch {
    return fallback;
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

function safeAttachment(input: Record<string, unknown>) {
  return {
    name: String(input.file_name ?? input.name ?? "attachment"),
    type: String(input.content_type ?? input.type ?? "unknown"),
    url: typeof input.content_url === "string" ? input.content_url : typeof input.url === "string" ? input.url : undefined,
    description:
      typeof input.size === "number"
        ? `attachment size=${input.size}`
        : typeof input.description === "string"
          ? input.description
          : undefined
  };
}

function toJiraDocument(text: string, marker: string) {
  const lines = `${text}\n\n${marker}`.split("\n");
  return {
    version: 1,
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      content: line
        ? [
            {
              type: "text",
              text: line
            }
          ]
        : []
    }))
  };
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
    const ticketResponse = await this.client.request<{ ticket: Record<string, unknown> }>(
      `${config.baseUrl.replace(/\/$/, "")}/api/v2/tickets/${lookup.supportTicketId}.json`,
      { headers }
    );
    const rawTicket = ticketResponse.data.ticket;
    const [commentsResponse, auditsResponse, requesterResponse, organizationResponse] = await Promise.all([
      optionalRequest(
        () =>
          this.client.request<{ comments?: Array<Record<string, unknown>> }>(
            `${config.baseUrl.replace(/\/$/, "")}/api/v2/tickets/${lookup.supportTicketId}/comments.json`,
            { headers }
          ),
        {}
      ),
      optionalRequest(
        () =>
          this.client.request<{ audits?: Array<Record<string, unknown>> }>(
            `${config.baseUrl.replace(/\/$/, "")}/api/v2/tickets/${lookup.supportTicketId}/audits.json`,
            { headers }
          ),
        {}
      ),
      rawTicket.requester_id
        ? optionalRequest(
            () =>
              this.client.request<{ user?: Record<string, unknown> }>(
                `${config.baseUrl.replace(/\/$/, "")}/api/v2/users/${String(rawTicket.requester_id)}.json`,
                { headers }
              ),
            {}
          )
        : Promise.resolve({} as { user?: Record<string, unknown> }),
      rawTicket.organization_id
        ? optionalRequest(
            () =>
              this.client.request<{ organization?: Record<string, unknown> }>(
                `${config.baseUrl.replace(/\/$/, "")}/api/v2/organizations/${String(rawTicket.organization_id)}.json`,
                { headers }
              ),
            {}
          )
        : Promise.resolve({} as { organization?: Record<string, unknown> })
    ]);

    const comments = commentsResponse.comments ?? [];
    const attachments = comments.flatMap((comment) =>
      Array.isArray(comment.attachments)
        ? comment.attachments
            .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
            .map((entry) => safeAttachment(entry))
        : []
    );
    const auditEvents = (auditsResponse.audits ?? []).map((audit) => ({
      id: String(audit.id ?? ""),
      created_at: audit.created_at,
      events: Array.isArray(audit.events) ? audit.events : []
    }));
    const customFields = Array.isArray(rawTicket.custom_fields)
      ? Object.fromEntries(
          rawTicket.custom_fields
            .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null && "id" in entry)
            .map((entry) => [String(entry.id), entry.value ?? null])
        )
      : {};

    return normalizeSupportTicket({
      ticketId: `zendesk-${lookup.supportTicketId}`,
      complaintText: String(rawTicket.description ?? rawTicket.subject ?? "not available"),
      userId: rawTicket.requester_id?.toString(),
      accountId: rawTicket.organization_id?.toString(),
      workspaceId: rawTicket.group_id?.toString(),
      severity: rawTicket.priority?.toString(),
      priority: rawTicket.priority?.toString(),
      status: rawTicket.status?.toString(),
      timestamps: {
        createdAt: rawTicket.created_at?.toString(),
        updatedAt: rawTicket.updated_at?.toString()
      },
      attachments,
      tags: Array.isArray(rawTicket.tags) ? rawTicket.tags.map((entry) => String(entry)) : [],
      supportAgentNotes: comments.map((comment) => String(comment.plain_body ?? comment.body ?? "not available")),
      customFields,
      requester: requesterResponse.user
        ? {
            id: requesterResponse.user.id?.toString(),
            name: requesterResponse.user.name?.toString(),
            email: requesterResponse.user.email?.toString()
          }
        : undefined,
      organization: organizationResponse.organization
        ? {
            id: organizationResponse.organization.id?.toString(),
            name: organizationResponse.organization.name?.toString()
          }
        : undefined,
      source: {
        platform: "zendesk",
        externalId: lookup.supportTicketId
      },
      rawSource: {
        ticket: rawTicket,
        comments: comments.map((comment) => ({
          id: comment.id,
          author_id: comment.author_id,
          public: comment.public,
          created_at: comment.created_at
        })),
        audits: auditEvents
      }
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

function mergeLabels(existing: unknown, desired: string[]): string[] {
  const existingValues = Array.isArray(existing)
    ? existing
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (entry && typeof entry === "object" && "name" in entry) {
            return String((entry as { name: unknown }).name);
          }
          return undefined;
        })
        .filter((entry): entry is string => Boolean(entry))
    : [];
  return [...new Set([...existingValues, ...desired])];
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
    const existingExternalId = input.existingLink?.externalId;

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

    const searchMatch = await optionalRequest(
      () =>
        this.client.request<{ items?: Array<{ number: number; html_url?: string; body?: string; labels?: unknown }> }>(
          `${config.baseUrl.replace(/\/$/, "")}/search/issues?q=${encodeURIComponent(`repo:${config.owner}/${config.repo} is:issue "${marker}"`)}`,
          { headers: this.headers() }
        ),
      undefined
    );
    const match = existingExternalId
      ? await optionalRequest(
          () =>
            this.client.request<{ number: number; html_url?: string; body?: string; labels?: unknown }>(
              `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues/${existingExternalId}`,
              { headers: this.headers() }
            ),
          undefined
        )
      : searchMatch?.items?.[0];
    const fallbackMatch =
      match ??
      (await optionalRequest(
        () =>
          this.client.request<Array<{ number: number; html_url?: string; body?: string; labels?: unknown }>>(
            `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues?state=all`,
            { headers: this.headers() }
          ),
        []
      )).find((issue) => issue.body?.includes(marker) || String(issue.number) === existingExternalId);

    if (fallbackMatch) {
      const updateUrl = `${config.baseUrl.replace(/\/$/, "")}/repos/${config.owner}/${config.repo}/issues/${fallbackMatch.number}`;
      await this.client.request(updateUrl, {
        method: "PATCH",
        headers: this.headers(),
        body: {
          title: input.issueDraft.title,
          body,
          labels: mergeLabels(fallbackMatch.labels, config.labels)
        }
      });
      return {
        target: this.target,
        externalId: String(fallbackMatch.number),
        externalKey,
        url: fallbackMatch.html_url,
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
    const existingExternalId = input.existingLink?.externalId;

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

    const searchResult = await optionalRequest(
      () =>
        this.client.request<{ issues?: Array<{ id: string; key: string; self?: string; fields?: { labels?: string[]; description?: string } }> }>(
          `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/search`,
          {
            method: "POST",
            headers: {
              ...this.headers(),
              accept: "application/json"
            },
            body: {
              jql: `project = ${config.projectKey} AND text ~ "\"${marker}\""`,
              maxResults: 50
            }
          }
        ),
      undefined
    );
    const match = existingExternalId
      ? await optionalRequest(
          () =>
            this.client.request<{ id: string; key: string; self?: string; fields?: { labels?: string[] } }>(
              `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${existingExternalId}`,
              {
                headers: {
                  ...this.headers(),
                  accept: "application/json"
                }
              }
            ),
          undefined
        )
      : searchResult?.issues?.[0];
    const fallbackJiraMatch =
      match ??
      (await optionalRequest(
        () =>
          this.client.request<{ issues?: Array<{ id: string; key: string; self?: string; fields?: { labels?: string[]; description?: string } }> }>(
            `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/search`,
            {
              method: "POST",
              headers: {
                ...this.headers(),
                accept: "application/json"
              },
              body: {
                jql: `project = ${config.projectKey}`,
                maxResults: 50
              }
            }
          ),
        { issues: [] }
      )).issues?.find(
        (issue) => issue.id === existingExternalId || issue.key === existingExternalId || issue.fields?.description?.includes(marker)
      );

    const description = toJiraDocument(input.issueDraft.body, marker);

    if (fallbackJiraMatch) {
      const updateUrl = `${config.baseUrl.replace(/\/$/, "")}/rest/api/3/issue/${fallbackJiraMatch.id}`;
      await this.client.request(updateUrl, {
        method: "PUT",
        headers: this.headers(),
        body: {
          fields: {
            summary: input.issueDraft.title,
            description,
            labels: mergeLabels(fallbackJiraMatch.fields?.labels, config.labels),
            priority: config.priority ? { name: config.priority } : undefined,
            components: config.components.map((name) => ({ name })),
            ...config.customFields
          }
        }
      });
      return {
        target: this.target,
        externalId: fallbackJiraMatch.id,
        externalKey,
        url: fallbackJiraMatch.self,
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
          labels: config.labels,
          priority: config.priority ? { name: config.priority } : undefined,
          components: config.components.map((name) => ({ name })),
          ...config.customFields
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

export function createHttpClient(config: AppConfig, metrics?: MetricsRegistry) {
  return new HttpJsonClient(config, metrics);
}
