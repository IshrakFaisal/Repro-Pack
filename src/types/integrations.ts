import { z } from "zod";

export const SecretRefSchema = z.object({
  env: z.string().min(1)
});

export const ZendeskProviderConfigSchema = z.object({
  type: z.literal("zendesk"),
  baseUrl: z.string().url(),
  email: SecretRefSchema.optional(),
  apiToken: SecretRefSchema.optional(),
  bearerToken: SecretRefSchema.optional()
});

export const GenericHttpContextProviderConfigSchema = z.object({
  type: z.enum(["http-logs", "http-session", "http-flags", "http-release"]),
  baseUrl: z.string().url(),
  path: z.string().min(1),
  bearerToken: SecretRefSchema.optional(),
  authHeaderName: z.string().optional(),
  extraHeaders: z.record(z.string()).default({})
});

export const GitHubIssueProviderConfigSchema = z.object({
  type: z.literal("github"),
  baseUrl: z.string().url().default("https://api.github.com"),
  owner: z.string().min(1),
  repo: z.string().min(1),
  token: SecretRefSchema,
  labels: z.array(z.string()).default(["support", "bug", "repro-pack"])
});

export const JiraIssueProviderConfigSchema = z.object({
  type: z.literal("jira"),
  baseUrl: z.string().url(),
  projectKey: z.string().min(1),
  issueType: z.string().default("Bug"),
  email: SecretRefSchema.optional(),
  apiToken: SecretRefSchema.optional(),
  bearerToken: SecretRefSchema.optional(),
  labels: z.array(z.string()).default(["support", "repro-pack"])
});

export const TenantProviderConfigSchema = z.object({
  support: ZendeskProviderConfigSchema.optional(),
  logs: GenericHttpContextProviderConfigSchema.optional(),
  session: GenericHttpContextProviderConfigSchema.optional(),
  featureFlags: GenericHttpContextProviderConfigSchema.optional(),
  release: GenericHttpContextProviderConfigSchema.optional(),
  github: GitHubIssueProviderConfigSchema.optional(),
  jira: JiraIssueProviderConfigSchema.optional()
});

export const TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  redactDirectIdentifiers: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  providers: TenantProviderConfigSchema.default({})
});

export const ResolvedZendeskProviderConfigSchema = z.object({
  type: z.literal("zendesk"),
  baseUrl: z.string().url(),
  email: z.string().optional(),
  apiToken: z.string().optional(),
  bearerToken: z.string().optional()
});

export const ResolvedGenericHttpContextProviderConfigSchema = z.object({
  type: z.enum(["http-logs", "http-session", "http-flags", "http-release"]),
  baseUrl: z.string().url(),
  path: z.string().min(1),
  token: z.string().optional(),
  authHeaderName: z.string().optional(),
  extraHeaders: z.record(z.string()).default({})
});

export const ResolvedGitHubIssueProviderConfigSchema = z.object({
  type: z.literal("github"),
  baseUrl: z.string().url(),
  owner: z.string(),
  repo: z.string(),
  token: z.string(),
  labels: z.array(z.string()).default(["support", "bug", "repro-pack"])
});

export const ResolvedJiraIssueProviderConfigSchema = z.object({
  type: z.literal("jira"),
  baseUrl: z.string().url(),
  projectKey: z.string(),
  issueType: z.string(),
  email: z.string().optional(),
  apiToken: z.string().optional(),
  bearerToken: z.string().optional(),
  labels: z.array(z.string()).default(["support", "repro-pack"])
});

export const ResolvedTenantProviderConfigSchema = z.object({
  support: ResolvedZendeskProviderConfigSchema.optional(),
  logs: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  session: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  featureFlags: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  release: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  github: ResolvedGitHubIssueProviderConfigSchema.optional(),
  jira: ResolvedJiraIssueProviderConfigSchema.optional()
});

export const ResolvedTenantConfigSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  redactDirectIdentifiers: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  providers: ResolvedTenantProviderConfigSchema
});

export const IssueTargetSchema = z.enum(["github", "jira"]);

export const IssueLinkSchema = z.object({
  target: IssueTargetSchema,
  externalId: z.string(),
  externalKey: z.string(),
  url: z.string().optional(),
  status: z.enum(["preview", "created", "updated"]),
  syncedAt: z.string(),
  idempotencyKey: z.string()
});

export const AuditEventSchema = z.object({
  eventId: z.string(),
  timestamp: z.string(),
  tenantId: z.string(),
  ticketId: z.string().optional(),
  action: z.string(),
  outcome: z.enum(["success", "error"]),
  metadata: z.record(z.unknown()).default({})
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type ResolvedTenantConfig = z.infer<typeof ResolvedTenantConfigSchema>;
export type IssueTarget = z.infer<typeof IssueTargetSchema>;
export type IssueLink = z.infer<typeof IssueLinkSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
