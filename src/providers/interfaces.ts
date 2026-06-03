import type { AppConfig } from "../config/env";
import type { IssueLink, IssueTarget, ResolvedTenantConfig } from "../types/integrations";
import type {
  EnrichedContext,
  FeatureFlagContext,
  LogsContext,
  ProviderResultOf,
  ReleaseInfo,
  SessionContext,
  SupportTicket
} from "../types/schemas";

export type TicketLookup =
  | {
      fixtureId: string;
    }
  | {
      ticketPath: string;
    }
  | {
      supportTicketId: string;
    };

export interface SupportProvider {
  name: string;
  loadTicket(lookup: TicketLookup): Promise<SupportTicket>;
}

export interface LogsProvider {
  name: string;
  fetch(ticket: SupportTicket): Promise<ProviderResultOf<LogsContext>>;
}

export interface FeatureFlagProvider {
  name: string;
  fetch(ticket: SupportTicket): Promise<ProviderResultOf<FeatureFlagContext>>;
}

export interface ReleaseProvider {
  name: string;
  fetch(ticket: SupportTicket): Promise<ProviderResultOf<ReleaseInfo>>;
}

export interface SessionProvider {
  name: string;
  fetch(ticket: SupportTicket): Promise<ProviderResultOf<SessionContext>>;
}

export interface IssueTrackerProvider {
  name: string;
  target: IssueTarget;
  sync(input: {
    tenantId: string;
    ticket: SupportTicket;
    issueDraft: import("../types/schemas").IssueDraft;
    existingLink?: IssueLink;
    dryRun: boolean;
  }): Promise<IssueLink>;
}

export type ProviderSet = {
  config: AppConfig;
  tenant: ResolvedTenantConfig | undefined;
  support: SupportProvider;
  logs: LogsProvider;
  featureFlags: FeatureFlagProvider;
  release: ReleaseProvider;
  session: SessionProvider;
  issueTrackers: Partial<Record<IssueTarget, IssueTrackerProvider>>;
};

export type ProcessRequestInput = {
  tenantId?: string;
  dryRun?: boolean;
  writeArtifacts?: boolean;
  fixtureId?: string;
  ticketPath?: string;
  supportTicketId?: string;
  ticket?: unknown;
  maxAttempts?: number;
};

export type ProcessResult = {
  ticket: SupportTicket;
  context: EnrichedContext;
  reproPack: import("../types/schemas").ReproPack;
  issueDraft: import("../types/schemas").IssueDraft;
  markdown: string;
  artifactPaths: {
    json?: string;
    markdown?: string;
  };
  dryRun: boolean;
};

export interface ProviderRegistry {
  create(input?: { tenantId?: string }): Promise<ProviderSet>;
}
