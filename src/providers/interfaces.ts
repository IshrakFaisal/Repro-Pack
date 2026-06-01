import type { AppConfig } from "../config/env";
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

export type ProviderSet = {
  config: AppConfig;
  support: SupportProvider;
  logs: LogsProvider;
  featureFlags: FeatureFlagProvider;
  release: ReleaseProvider;
  session: SessionProvider;
};

export type ProcessRequestInput = {
  dryRun?: boolean;
  writeArtifacts?: boolean;
  fixtureId?: string;
  ticketPath?: string;
  ticket?: unknown;
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
