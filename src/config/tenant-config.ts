import path from "node:path";
import type { AppConfig } from "./env";
import type { SecretManager } from "../secrets/manager";
import {
  ResolvedGitHubIssueProviderConfigSchema,
  ResolvedGenericHttpContextProviderConfigSchema,
  ResolvedJiraIssueProviderConfigSchema,
  ResolvedLlmConfigSchema,
  ResolvedSlackConfigSchema,
  ResolvedTenantConfigSchema,
  ResolvedWebhookConfigSchema,
  ResolvedZendeskProviderConfigSchema,
  TenantConfigSchema,
  type TenantConfig,
  type ResolvedTenantConfig
} from "../types/integrations";
import { fileExists, readJsonFile } from "../utils/fs";
import fs from "node:fs/promises";

export class TenantConfigStore {
  constructor(
    private readonly config: AppConfig,
    private readonly secretManager: SecretManager
  ) {}

  async resolve(tenantId: string | undefined): Promise<ResolvedTenantConfig | undefined> {
    if (!tenantId) {
      return undefined;
    }

    const filePath = path.join(this.config.tenantConfigRoot, `${tenantId}.json`);
    if (!(await fileExists(filePath))) {
      if (tenantId === "default") {
        return undefined;
      }

      const error = new Error(`Tenant config not found for tenant ${tenantId}`);
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }

    const raw = TenantConfigSchema.parse(await readJsonFile<unknown>(filePath));

    return ResolvedTenantConfigSchema.parse({
      tenantId: raw.tenantId,
      name: raw.name,
      redactDirectIdentifiers: raw.redactDirectIdentifiers,
      retentionDays: raw.retentionDays,
      dataResidencyMode: raw.dataResidencyMode,
      requireCustomerConsent: raw.requireCustomerConsent,
      llm: raw.llm
        ? ResolvedLlmConfigSchema.parse({
            ...raw.llm,
            apiKey: await this.secretManager.resolve(raw.llm.apiKey)
          })
        : undefined,
      auth: {
        apiKeys: await Promise.all(
          raw.auth.apiKeys.map(async (key) => ({
            keyId: key.keyId,
            actorId: key.actorId,
            resolvedSecret: await this.secretManager.resolve(key.secret),
            roles: key.roles
          }))
        )
      },
      providers: {
        support: raw.providers.support
          ? ResolvedZendeskProviderConfigSchema.parse({
              ...raw.providers.support,
              email: await this.secretManager.resolve(raw.providers.support.email),
              apiToken: await this.secretManager.resolve(raw.providers.support.apiToken),
              bearerToken: await this.secretManager.resolve(raw.providers.support.bearerToken)
            })
          : undefined,
        logs: raw.providers.logs
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.logs,
              token: await this.secretManager.resolve(raw.providers.logs.bearerToken)
            })
          : undefined,
        session: raw.providers.session
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.session,
              token: await this.secretManager.resolve(raw.providers.session.bearerToken)
            })
          : undefined,
        featureFlags: raw.providers.featureFlags
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.featureFlags,
              token: await this.secretManager.resolve(raw.providers.featureFlags.bearerToken)
            })
          : undefined,
        release: raw.providers.release
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.release,
              token: await this.secretManager.resolve(raw.providers.release.bearerToken)
            })
          : undefined,
        github: raw.providers.github
          ? ResolvedGitHubIssueProviderConfigSchema.parse({
              ...raw.providers.github,
              token: await this.secretManager.resolve(raw.providers.github.token)
            })
          : undefined,
        jira: raw.providers.jira
          ? ResolvedJiraIssueProviderConfigSchema.parse({
              ...raw.providers.jira,
              email: await this.secretManager.resolve(raw.providers.jira.email),
              apiToken: await this.secretManager.resolve(raw.providers.jira.apiToken),
              bearerToken: await this.secretManager.resolve(raw.providers.jira.bearerToken)
            })
          : undefined,
        slack: raw.providers.slack
          ? ResolvedSlackConfigSchema.parse({
              ...raw.providers.slack,
              webhookUrl: await this.secretManager.resolve(raw.providers.slack.webhookUrl)
            })
          : undefined,
        webhook: raw.providers.webhook
          ? ResolvedWebhookConfigSchema.parse({
              ...raw.providers.webhook,
              secret: await this.secretManager.resolve(raw.providers.webhook.secret)
            })
          : undefined
      }
    });
  }

  async loadRaw(tenantId: string): Promise<TenantConfig | undefined> {
    const filePath = path.join(this.config.tenantConfigRoot, `${tenantId}.json`);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return TenantConfigSchema.parse(await readJsonFile<unknown>(filePath));
  }

  async listTenantIds(): Promise<string[]> {
    if (!(await fileExists(this.config.tenantConfigRoot))) {
      return [];
    }

    const entries = await fs.readdir(this.config.tenantConfigRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.replace(/\.json$/i, ""))
      .sort();
  }
}
