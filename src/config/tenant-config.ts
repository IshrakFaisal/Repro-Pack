import path from "node:path";
import type { AppConfig } from "./env";
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

function resolveSecret(reference: { env: string } | undefined): string | undefined {
  if (!reference) {
    return undefined;
  }

  return process.env[reference.env]?.trim() || undefined;
}

export class TenantConfigStore {
  constructor(private readonly config: AppConfig) {}

  async resolve(tenantId: string | undefined): Promise<ResolvedTenantConfig | undefined> {
    if (!tenantId) {
      return undefined;
    }

    const filePath = path.join(this.config.tenantConfigRoot, `${tenantId}.json`);
    if (!(await fileExists(filePath))) {
      throw new Error(`Tenant config not found for tenant ${tenantId}`);
    }

    const raw = TenantConfigSchema.parse(await readJsonFile<unknown>(filePath));

    return ResolvedTenantConfigSchema.parse({
      tenantId: raw.tenantId,
      name: raw.name,
      redactDirectIdentifiers: raw.redactDirectIdentifiers,
      retentionDays: raw.retentionDays,
      providers: {
        support: raw.providers.support
          ? ResolvedZendeskProviderConfigSchema.parse({
              ...raw.providers.support,
              email: resolveSecret(raw.providers.support.email),
              apiToken: resolveSecret(raw.providers.support.apiToken),
              bearerToken: resolveSecret(raw.providers.support.bearerToken)
            })
          : undefined,
        logs: raw.providers.logs
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.logs,
              token: resolveSecret(raw.providers.logs.bearerToken)
            })
          : undefined,
        session: raw.providers.session
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.session,
              token: resolveSecret(raw.providers.session.bearerToken)
            })
          : undefined,
        featureFlags: raw.providers.featureFlags
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.featureFlags,
              token: resolveSecret(raw.providers.featureFlags.bearerToken)
            })
          : undefined,
        release: raw.providers.release
          ? ResolvedGenericHttpContextProviderConfigSchema.parse({
              ...raw.providers.release,
              token: resolveSecret(raw.providers.release.bearerToken)
            })
          : undefined,
        github: raw.providers.github
          ? ResolvedGitHubIssueProviderConfigSchema.parse({
              ...raw.providers.github,
              token: resolveSecret(raw.providers.github.token)
            })
          : undefined,
        jira: raw.providers.jira
          ? ResolvedJiraIssueProviderConfigSchema.parse({
              ...raw.providers.jira,
              email: resolveSecret(raw.providers.jira.email),
              apiToken: resolveSecret(raw.providers.jira.apiToken),
              bearerToken: resolveSecret(raw.providers.jira.bearerToken)
            })
          : undefined
      }
    });
  }
}
