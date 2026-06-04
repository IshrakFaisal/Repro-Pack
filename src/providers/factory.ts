import { TenantConfigStore } from "../config/tenant-config";
import type { AppConfig } from "../config/env";
import type { MetricsRegistry } from "../observability/metrics";
import type { SecretManager } from "../secrets/manager";
import type { FeatureFlagContext, LogsContext, ProviderResultOf, ReleaseInfo, SessionContext, SupportTicket } from "../types/schemas";
import type { ProviderRegistry, ProviderSet } from "./interfaces";
import {
  createHttpClient,
  DatadogLogsProvider,
  GitHubIssueTracker,
  HttpFeatureFlagProvider,
  HttpLogsProvider,
  HttpReleaseProvider,
  HttpSessionProvider,
  IntercomSupportProvider,
  JiraIssueTracker,
  LinearIssueTracker,
  SentryLogsProvider,
  ZendeskSupportProvider
} from "./http-integration-providers";
import {
  FixtureFeatureFlagProvider,
  FixtureLogsProvider,
  FixtureReleaseProvider,
  FixtureSessionProvider,
  FixtureSupportProvider
} from "./mock-fixture-provider";
import { SlackNotificationProvider } from "./slack";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

const noopLogger: MinimalLogger = {
  info: () => undefined,
  error: () => undefined
};

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

  constructor(
    private readonly config: AppConfig,
    secretManager: SecretManager,
    private readonly metrics?: MetricsRegistry,
    private readonly logger: MinimalLogger = noopLogger
  ) {
    this.tenantConfigStore = new TenantConfigStore(config, secretManager);
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
        issueTrackers: {},
        notifications: {}
      };
    }

    const client = createHttpClient(this.config, this.metrics);

    return {
      config: this.config,
      tenant,
      support: tenant.providers.intercom
        ? new IntercomSupportProvider(tenant, client)
        : tenant.providers.support
          ? new ZendeskSupportProvider(tenant, client)
          : new FixtureSupportProvider(this.config.fixtureRoot),
      logs: tenant.providers.sentry
        ? new SentryLogsProvider(tenant, client)
        : tenant.providers.datadog
          ? new DatadogLogsProvider(tenant, client)
          : tenant.providers.logs
            ? new HttpLogsProvider(tenant, client)
            : new UnavailableLogsProvider(),
      featureFlags: tenant.providers.featureFlags
        ? new HttpFeatureFlagProvider(tenant, client)
        : new UnavailableFeatureFlagProvider(),
      release: tenant.providers.release ? new HttpReleaseProvider(tenant, client) : new UnavailableReleaseProvider(),
      session: tenant.providers.session ? new HttpSessionProvider(tenant, client) : new UnavailableSessionProvider(),
      issueTrackers: {
        github: tenant.providers.github ? new GitHubIssueTracker(tenant, client) : undefined,
        jira: tenant.providers.jira ? new JiraIssueTracker(tenant, client) : undefined,
        linear: tenant.providers.linear ? new LinearIssueTracker(tenant, client) : undefined
      },
      notifications: {
        slack: tenant.providers.slack?.enabled ? new SlackNotificationProvider(tenant, this.config, this.logger) : undefined
      }
    };
  }
}

export function createProviderRegistry(
  config: AppConfig,
  secretManager: SecretManager,
  metrics?: MetricsRegistry,
  logger?: MinimalLogger
): ProviderRegistry {
  return new AppProviderRegistry(config, secretManager, metrics, logger);
}
