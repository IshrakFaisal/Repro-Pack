import path from "node:path";
import type { AppConfig } from "./env";
import type { SecretManager } from "../secrets/manager";
import {
  ResolvedGitHubIssueProviderConfigSchema,
  ResolvedGenericHttpContextProviderConfigSchema,
  ResolvedJiraIssueProviderConfigSchema,
  ResolvedTenantConfigSchema,
  ResolvedZendeskProviderConfigSchema,
  TenantConfigSchema,
  type ResolvedTenantConfig
} from "../types/integrations";
import { fileExists, readJsonFile } from "../utils/fs";

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
          : undefined
      }
    });
  }
}
