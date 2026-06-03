import { z } from "zod";

const EnvSecretRefSchema = z.object({
  provider: z.literal("env").default("env"),
  env: z.string().min(1)
});

const AwsSecretRefSchema = z.object({
  provider: z.literal("aws"),
  secretId: z.string().min(1),
  jsonKey: z.string().optional()
});

const GcpSecretRefSchema = z.object({
  provider: z.literal("gcp"),
  secretName: z.string().min(1),
  version: z.string().optional()
});

const AzureSecretRefSchema = z.object({
  provider: z.literal("azure"),
  vaultUrl: z.string().url(),
  secretName: z.string().min(1),
  version: z.string().optional()
});

const VaultSecretRefSchema = z.object({
  provider: z.literal("vault"),
  path: z.string().min(1),
  field: z.string().min(1)
});

export const SecretRefSchema = z.union([
  EnvSecretRefSchema,
  AwsSecretRefSchema,
  GcpSecretRefSchema,
  AzureSecretRefSchema,
  VaultSecretRefSchema
]);

export const TenantApiKeySchema = z.object({
  keyId: z.string().min(1),
  actorId: z.string().min(1),
  secret: SecretRefSchema,
  roles: z.array(z.enum(["read", "process", "review", "sync", "admin"])).default(["read", "process"])
});

export const TenantAuthConfigSchema = z.object({
  apiKeys: z.array(TenantApiKeySchema).default([])
});

export const ResolvedTenantApiKeySchema = z.object({
  keyId: z.string().min(1),
  actorId: z.string().min(1),
  resolvedSecret: z.string().optional(),
  roles: z.array(z.enum(["read", "process", "review", "sync", "admin"])).default(["read", "process"])
});

export const ResolvedTenantAuthConfigSchema = z.object({
  apiKeys: z.array(ResolvedTenantApiKeySchema).default([])
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
  labels: z.array(z.string()).default(["support", "repro-pack"]),
  priority: z.string().optional(),
  components: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({})
});

export const LlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string().min(1).default("claude-sonnet-4-20250514"),
  apiKey: SecretRefSchema.default({ provider: "env", env: "ANTHROPIC_API_KEY" })
});

export const SlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: SecretRefSchema,
  channel: z.string().min(1).default("#repro-approvals")
});

export const WebhookEventNameSchema = z.enum(["pack.processed", "pack.approved", "pack.synced"]);

export const WebhookConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url(),
  secret: SecretRefSchema,
  events: z.array(WebhookEventNameSchema).default(["pack.processed", "pack.approved", "pack.synced"])
});

export const TenantProviderConfigSchema = z.object({
  support: ZendeskProviderConfigSchema.optional(),
  logs: GenericHttpContextProviderConfigSchema.optional(),
  session: GenericHttpContextProviderConfigSchema.optional(),
  featureFlags: GenericHttpContextProviderConfigSchema.optional(),
  release: GenericHttpContextProviderConfigSchema.optional(),
  github: GitHubIssueProviderConfigSchema.optional(),
  jira: JiraIssueProviderConfigSchema.optional(),
  slack: SlackConfigSchema.optional(),
  webhook: WebhookConfigSchema.optional()
});

export const TenantConfigSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  redactDirectIdentifiers: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  llm: LlmConfigSchema.optional(),
  auth: TenantAuthConfigSchema.default({ apiKeys: [] }),
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
  labels: z.array(z.string()).default(["support", "repro-pack"]),
  priority: z.string().optional(),
  components: z.array(z.string()).default([]),
  customFields: z.record(z.unknown()).default({})
});

export const ResolvedLlmConfigSchema = z.object({
  enabled: z.boolean().default(false),
  model: z.string(),
  apiKey: z.string().optional()
});

export const ResolvedSlackConfigSchema = z.object({
  enabled: z.boolean().default(false),
  webhookUrl: z.string().optional(),
  channel: z.string().default("#repro-approvals")
});

export const ResolvedWebhookConfigSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(WebhookEventNameSchema).default(["pack.processed", "pack.approved", "pack.synced"])
});

export const ResolvedTenantProviderConfigSchema = z.object({
  support: ResolvedZendeskProviderConfigSchema.optional(),
  logs: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  session: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  featureFlags: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  release: ResolvedGenericHttpContextProviderConfigSchema.optional(),
  github: ResolvedGitHubIssueProviderConfigSchema.optional(),
  jira: ResolvedJiraIssueProviderConfigSchema.optional(),
  slack: ResolvedSlackConfigSchema.optional(),
  webhook: ResolvedWebhookConfigSchema.optional()
});

export const ResolvedTenantConfigSchema = z.object({
  tenantId: z.string(),
  name: z.string(),
  redactDirectIdentifiers: z.boolean().optional(),
  retentionDays: z.number().int().positive().optional(),
  llm: ResolvedLlmConfigSchema.optional(),
  auth: ResolvedTenantAuthConfigSchema.default({ apiKeys: [] }),
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
  actor: z
    .object({
      actorId: z.string(),
      authMethod: z.string(),
      roles: z.array(z.string()).default([])
    })
    .optional(),
  metadata: z.record(z.unknown()).default({})
});

export type TenantConfig = z.infer<typeof TenantConfigSchema>;
export type ResolvedTenantConfig = z.infer<typeof ResolvedTenantConfigSchema>;
export type SecretRef = z.infer<typeof SecretRefSchema>;
export type TenantApiKey = z.infer<typeof TenantApiKeySchema>;
export type WebhookEventName = z.infer<typeof WebhookEventNameSchema>;
export type IssueTarget = z.infer<typeof IssueTargetSchema>;
export type IssueLink = z.infer<typeof IssueLinkSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
