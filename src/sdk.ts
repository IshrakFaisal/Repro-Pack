import type {
  FeatureFlagContext,
  LogsContext,
  ProviderResultOf,
  ReleaseInfo,
  SessionContext,
  SupportTicket
} from "./types/schemas";
import type {
  FeatureFlagProvider,
  LogsProvider,
  ReleaseProvider,
  SessionProvider,
  SupportProvider,
  TicketLookup
} from "./providers/interfaces";

function nowIso(): string {
  return new Date().toISOString();
}

export type {
  FeatureFlagProvider,
  LogsProvider,
  ReleaseProvider,
  SessionProvider,
  SupportProvider,
  TicketLookup
} from "./providers/interfaces";

export function providerSuccess<T>(provider: string, data: T, latencyMs = 0): ProviderResultOf<T> {
  return {
    provider,
    status: "success",
    fetchedAt: nowIso(),
    latencyMs,
    data
  };
}

export function providerUnavailable<T>(provider: string, errorSummary: string): ProviderResultOf<T> {
  return {
    provider,
    status: "unavailable",
    fetchedAt: nowIso(),
    latencyMs: 0,
    errorSummary
  };
}

export function createSupportProvider(input: {
  name: string;
  loadTicket: (lookup: TicketLookup) => Promise<SupportTicket>;
}): SupportProvider {
  return input;
}

export function createLogsProvider(input: {
  name: string;
  fetch: (ticket: SupportTicket) => Promise<ProviderResultOf<LogsContext>>;
}): LogsProvider {
  return input;
}

export function createSessionProvider(input: {
  name: string;
  fetch: (ticket: SupportTicket) => Promise<ProviderResultOf<SessionContext>>;
}): SessionProvider {
  return input;
}

export function createFeatureFlagProvider(input: {
  name: string;
  fetch: (ticket: SupportTicket) => Promise<ProviderResultOf<FeatureFlagContext>>;
}): FeatureFlagProvider {
  return input;
}

export function createReleaseProvider(input: {
  name: string;
  fetch: (ticket: SupportTicket) => Promise<ProviderResultOf<ReleaseInfo>>;
}): ReleaseProvider {
  return input;
}
