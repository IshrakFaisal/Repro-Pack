import path from "node:path";
import {
  FeatureFlagContextSchema,
  LogsContextSchema,
  ReleaseInfoSchema,
  SessionContextSchema,
  SupportTicketSchema,
  type FeatureFlagContext,
  type LogsContext,
  type ProviderResultOf,
  type ReleaseInfo,
  type SessionContext,
  type SupportTicket
} from "../types/schemas";
import { fileExists, readJsonFile } from "../utils/fs";
import type {
  FeatureFlagProvider,
  LogsProvider,
  ReleaseProvider,
  SessionProvider,
  SupportProvider,
  TicketLookup
} from "./interfaces";

function nowIso(): string {
  return new Date().toISOString();
}

async function withProviderResult<T>(
  provider: string,
  loader: () => Promise<T>
): Promise<ProviderResultOf<T>> {
  const startedAt = Date.now();

  try {
    const data = await loader();
    return {
      provider,
      status: "success",
      fetchedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      data
    };
  } catch (error) {
    return {
      provider,
      status: "error",
      fetchedAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      errorSummary: error instanceof Error ? error.message : "Unknown provider error"
    };
  }
}

async function loadFixtureJson<T>(
  fixtureRoot: string,
  ticketId: string,
  fileName: string
): Promise<T | undefined> {
  const filePath = path.join(fixtureRoot, ticketId, fileName);

  if (!(await fileExists(filePath))) {
    return undefined;
  }

  return readJsonFile<T>(filePath);
}

export class FixtureSupportProvider implements SupportProvider {
  name = "fixture-support";

  constructor(private readonly fixtureRoot: string) {}

  async loadTicket(lookup: TicketLookup): Promise<SupportTicket> {
    const filePath =
      "fixtureId" in lookup
        ? path.join(this.fixtureRoot, lookup.fixtureId, "ticket.json")
        : path.resolve(lookup.ticketPath);
    const raw = await readJsonFile<unknown>(filePath);
    return SupportTicketSchema.parse(raw);
  }
}

export class FixtureLogsProvider implements LogsProvider {
  name = "fixture-logs";

  constructor(private readonly fixtureRoot: string) {}

  async fetch(ticket: SupportTicket): Promise<ProviderResultOf<LogsContext>> {
    const provider = this.name;
    const startedAt = Date.now();
    const raw = await loadFixtureJson<unknown>(this.fixtureRoot, ticket.ticketId, "logs.json");

    if (!raw) {
      return {
        provider,
        status: "unavailable",
        fetchedAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        errorSummary: "No logs fixture available for ticket"
      };
    }

    return withProviderResult(provider, async () => LogsContextSchema.parse(raw));
  }
}

export class FixtureFeatureFlagProvider implements FeatureFlagProvider {
  name = "fixture-flags";

  constructor(private readonly fixtureRoot: string) {}

  async fetch(ticket: SupportTicket): Promise<ProviderResultOf<FeatureFlagContext>> {
    const provider = this.name;
    const startedAt = Date.now();
    const raw = await loadFixtureJson<unknown>(this.fixtureRoot, ticket.ticketId, "flags.json");

    if (!raw) {
      return {
        provider,
        status: "unavailable",
        fetchedAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        errorSummary: "No feature flag fixture available for ticket"
      };
    }

    return withProviderResult(provider, async () => FeatureFlagContextSchema.parse(raw));
  }
}

export class FixtureReleaseProvider implements ReleaseProvider {
  name = "fixture-release";

  constructor(private readonly fixtureRoot: string) {}

  async fetch(ticket: SupportTicket): Promise<ProviderResultOf<ReleaseInfo>> {
    const provider = this.name;
    const startedAt = Date.now();
    const raw = await loadFixtureJson<unknown>(this.fixtureRoot, ticket.ticketId, "release.json");

    if (!raw) {
      return {
        provider,
        status: "unavailable",
        fetchedAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        errorSummary: "No release fixture available for ticket"
      };
    }

    return withProviderResult(provider, async () => ReleaseInfoSchema.parse(raw));
  }
}

export class FixtureSessionProvider implements SessionProvider {
  name = "fixture-session";

  constructor(private readonly fixtureRoot: string) {}

  async fetch(ticket: SupportTicket): Promise<ProviderResultOf<SessionContext>> {
    const provider = this.name;
    const startedAt = Date.now();
    const raw = await loadFixtureJson<unknown>(this.fixtureRoot, ticket.ticketId, "session.json");

    if (!raw) {
      return {
        provider,
        status: "unavailable",
        fetchedAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        errorSummary: "No session fixture available for ticket"
      };
    }

    return withProviderResult(provider, async () => SessionContextSchema.parse(raw));
  }
}
