import { TenantConfigStore } from "../config/tenant-config";
import type { AppConfig } from "../config/env";
import type { FeatureFlagContext, LogsContext, ProviderResultOf, ReleaseInfo, SessionContext, SupportTicket } from "../types/schemas";
import type { ProviderRegistry, ProviderSet } from "./interfaces";
import {
  createHttpClient,
  GitHubIssueTracker,
  HttpFeatureFlagProvider,
  HttpLogsProvider,
  HttpReleaseProvider,
  HttpSessionProvider,
  JiraIssueTracker,
  ZendeskSupportProvider
} from "./http-integration-providers";
import {
  FixtureFeatureFlagProvider,
  FixtureLogsProvider,
  FixtureReleaseProvider,
  FixtureSessionProvider,
  FixtureSupportProvider
} from "./mock-fixture-provider";

class UnavailableLogsProvider {
  name = "unavailable-logs";

  async fetch(): Promise<ProviderResultOf<LogsContext>> {
    return {
      provider: this.name,
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      latencyMs: 0,
      errorSummary: "Logs provider not configured"
    };
  }
}

class UnavailableSessionProvider {
  name = "unavailable-session";

  async fetch(): Promise<ProviderResultOf<SessionContext>> {
    return {
      provider: this.name,
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      latencyMs: 0,
      errorSummary: "Session provider not configured"
    };
  }
}

class UnavailableFeatureFlagProvider {
  name = "unavailable-flags";

  async fetch(): Promise<ProviderResultOf<FeatureFlagContext>> {
    return {
      provider: this.name,
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      latencyMs: 0,
      errorSummary: "Feature flag provider not configured"
    };
  }
}

class UnavailableReleaseProvider {
  name = "unavailable-release";

  async fetch(): Promise<ProviderResultOf<ReleaseInfo>> {
    return {
      provider: this.name,
      status: "unavailable",
      fetchedAt: new Date().toISOString(),
      latencyMs: 0,
      errorSummary: "Release provider not configured"
    };
  }
}

export class AppProviderRegistry implements ProviderRegistry {
  private readonly tenantConfigStore: TenantConfigStore;

  constructor(private readonly config: AppConfig) {
    this.tenantConfigStore = new TenantConfigStore(config);
  }

  async create(input?: { tenantId?: string }): Promise<ProviderSet> {
    const tenant = await this.tenantConfigStore.resolve(input?.tenantId);

    if (!tenant) {
      return {
        config: this.config,
        tenant: undefined,
        support: new FixtureSupportProvider(this.config.fixtureRoot),
        logs: new FixtureLogsProvider(this.config.fixtureRoot),
        featureFlags: new FixtureFeatureFlagProvider(this.config.fixtureRoot),
        release: new FixtureReleaseProvider(this.config.fixtureRoot),
        session: new FixtureSessionProvider(this.config.fixtureRoot),
        issueTrackers: {}
      };
    }

    const client = createHttpClient(this.config);

    return {
      config: this.config,
      tenant,
      support: tenant.providers.support
        ? new ZendeskSupportProvider(tenant, client)
        : new FixtureSupportProvider(this.config.fixtureRoot),
      logs: tenant.providers.logs ? new HttpLogsProvider(tenant, client) : new UnavailableLogsProvider(),
      featureFlags: tenant.providers.featureFlags
        ? new HttpFeatureFlagProvider(tenant, client)
        : new UnavailableFeatureFlagProvider(),
      release: tenant.providers.release ? new HttpReleaseProvider(tenant, client) : new UnavailableReleaseProvider(),
      session: tenant.providers.session ? new HttpSessionProvider(tenant, client) : new UnavailableSessionProvider(),
      issueTrackers: {
        github: tenant.providers.github ? new GitHubIssueTracker(tenant, client) : undefined,
        jira: tenant.providers.jira ? new JiraIssueTracker(tenant, client) : undefined
      }
    };
  }
}

export function createProviderRegistry(config: AppConfig): ProviderRegistry {
  return new AppProviderRegistry(config);
}
