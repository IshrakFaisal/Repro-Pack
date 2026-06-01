import type {
  EnrichedContext,
  EvidenceItem,
  FeatureFlag,
  LogEntry,
  NetworkRequest,
  NormalizedEvidenceBundle,
  TimelineEvent
} from "../types/schemas";
import { truncate } from "../utils/text";

function sortByTimestamp<T extends { timestamp?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftValue = left.timestamp ? new Date(left.timestamp).getTime() : 0;
    const rightValue = right.timestamp ? new Date(right.timestamp).getTime() : 0;
    return leftValue - rightValue;
  });
}

function notAvailable(value: string | undefined): string {
  return value ?? "not available";
}

function buildExpectedBehavior(context: EnrichedContext, networkCount: number): string {
  if (context.ticket.expectedBehavior) {
    return context.ticket.expectedBehavior;
  }

  if (networkCount > 0) {
    return "The reported action should complete without backend or network errors.";
  }

  return "The reported workflow should complete successfully.";
}

function buildActualBehavior(context: EnrichedContext): string {
  return context.ticket.actualBehavior ?? truncate(context.ticket.complaintText, 180);
}

function buildCustomerImpact(context: EnrichedContext): string {
  const severityPrefix = context.ticket.severity ? `${context.ticket.severity} severity: ` : "";
  return `${severityPrefix}${truncate(context.ticket.complaintText, 140)}`;
}

function extractNetworkEvidence(network: NetworkRequest[]): {
  evidence: EvidenceItem[];
  timeline: TimelineEvent[];
  exactIds: string[];
  samplePayload?: unknown;
} {
  const evidence: EvidenceItem[] = [];
  const timeline: TimelineEvent[] = [];
  const exactIds = new Set<string>();
  let samplePayload: unknown;

  for (const request of network) {
    if (request.requestId) {
      exactIds.add(request.requestId);
    }

    if (request.traceId) {
      exactIds.add(request.traceId);
    }

    evidence.push({
      type: "network",
      source: "session-network",
      timestamp: request.timestamp,
      summary: `${request.method} ${request.url}`,
      detail: request.responseSummary ?? `Observed ${request.method} ${request.url}`,
      confidence: request.status && request.status >= 400 ? 0.93 : 0.74,
      citation: `network:${request.requestId ?? request.url}`,
      relatedIds: [request.requestId, request.traceId].filter(Boolean) as string[],
      conflict: false
    });

    timeline.push({
      timestamp: request.timestamp,
      source: "session-network",
      title: `${request.method} ${request.url}`,
      detail: request.responseSummary ?? `Network request observed with status ${request.status ?? "not available"}`,
      level: request.status && request.status >= 400 ? "error" : "info",
      relatedIds: [request.requestId, request.traceId].filter(Boolean) as string[]
    });

    if (samplePayload === undefined && request.payload !== undefined) {
      samplePayload = request.payload;
    }
  }

  return { evidence, timeline, exactIds: [...exactIds], samplePayload };
}

function extractLogEvidence(logs: LogEntry[]): {
  evidence: EvidenceItem[];
  timeline: TimelineEvent[];
  exactIds: string[];
} {
  const evidence: EvidenceItem[] = [];
  const timeline: TimelineEvent[] = [];
  const exactIds = new Set<string>();

  for (const log of logs) {
    if (log.requestId) {
      exactIds.add(log.requestId);
    }

    if (log.traceId) {
      exactIds.add(log.traceId);
    }

    if (log.errorCode) {
      exactIds.add(log.errorCode);
    }

    evidence.push({
      type: "log",
      source: log.source,
      timestamp: log.timestamp,
      summary: log.errorCode ? `${log.errorCode}: ${log.message}` : log.message,
      detail: `Log level ${log.level}${log.requestId ? `, request ${log.requestId}` : ""}${log.traceId ? `, trace ${log.traceId}` : ""}`,
      confidence: log.level === "error" ? 0.95 : 0.68,
      citation: `log:${log.requestId ?? log.traceId ?? log.timestamp}`,
      relatedIds: [log.requestId, log.traceId, log.errorCode].filter(Boolean) as string[],
      conflict: false
    });

    timeline.push({
      timestamp: log.timestamp,
      source: log.source,
      title: log.message,
      detail: log.errorCode ? `Error code ${log.errorCode}` : `Log level ${log.level}`,
      level: log.level === "error" ? "error" : log.level === "warn" ? "warn" : "info",
      relatedIds: [log.requestId, log.traceId, log.errorCode].filter(Boolean) as string[]
    });
  }

  return { evidence, timeline, exactIds: [...exactIds] };
}

function addConflictEvidence(
  evidence: EvidenceItem[],
  ticketField: string | undefined,
  providerField: string | undefined,
  fieldName: string,
  citation: string
): void {
  if (ticketField && providerField && ticketField !== providerField) {
    evidence.push({
      type: "conflict",
      source: "normalizer",
      summary: `Conflicting ${fieldName} values`,
      detail: `Ticket source reported "${ticketField}" while provider data reported "${providerField}".`,
      confidence: 0.88,
      citation,
      relatedIds: [],
      conflict: true
    });
  }
}

function mapFlagEvidence(flags: FeatureFlag[]): EvidenceItem[] {
  return flags.map((flag) => ({
    type: "feature-flag",
    source: flag.source,
    summary: `${flag.name}=${flag.variant}`,
    detail: flag.reason ?? "Flag state captured during enrichment",
    confidence: 0.82,
    citation: `flag:${flag.name}`,
    relatedIds: [],
    conflict: false
  }));
}

export function normalizeEvidence(context: EnrichedContext): NormalizedEvidenceBundle {
  const session = context.session.data;
  const logs = context.logs.data;
  const release = context.release.data;
  const flags = context.featureFlags.data?.flags ?? [];

  const sessionEvents =
    session?.events.map((event) => ({
      timestamp: event.timestamp,
      source: "session",
      title: event.type,
      detail: event.route ? `${event.detail} on ${event.route}` : event.detail,
      level: "info" as const,
      relatedIds: []
    })) ?? [];

  const networkExtraction = extractNetworkEvidence(session?.network ?? []);
  const logExtraction = extractLogEvidence([...(logs?.entries ?? []), ...(logs?.recentErrors ?? [])]);
  const evidence: EvidenceItem[] = [
    ...networkExtraction.evidence,
    ...logExtraction.evidence,
    ...mapFlagEvidence(flags)
  ];

  addConflictEvidence(
    evidence,
    typeof context.ticket.rawSource?.browserVersion === "string"
      ? context.ticket.rawSource.browserVersion
      : undefined,
    session?.browserVersion,
    "browserVersion",
    "conflict:browserVersion"
  );

  addConflictEvidence(
    evidence,
    typeof context.ticket.rawSource?.appVersion === "string" ? context.ticket.rawSource.appVersion : undefined,
    release?.appVersion,
    "appVersion",
    "conflict:appVersion"
  );

  const timeline: TimelineEvent[] = sortByTimestamp([
    ...(context.ticket.timestamps.createdAt
      ? [
          {
            timestamp: context.ticket.timestamps.createdAt,
            source: "support",
            title: "Ticket created",
            detail: "Support ticket ingested",
            level: "info" as const,
            relatedIds: []
          }
        ]
      : []),
    ...sessionEvents,
    ...networkExtraction.timeline,
    ...logExtraction.timeline
  ]);

  const exactIds = [
    ...new Set([
      ...networkExtraction.exactIds,
      ...logExtraction.exactIds,
      release?.buildHash,
      release?.releaseIdentifier
    ].filter(Boolean))
  ] as string[];

  const openQuestions: string[] = [];
  if (!session) {
    openQuestions.push("Browser or session metadata not available.");
  }
  if (!logs) {
    openQuestions.push("Backend logs or correlated traces not available.");
  }
  if (flags.length === 0) {
    openQuestions.push("Feature flag state not available.");
  }

  return {
    environment: {
      browser: notAvailable(session?.browser),
      browserVersion: notAvailable(session?.browserVersion),
      device: notAvailable(session?.device),
      os: notAvailable(session?.os),
      appVersion: notAvailable(release?.appVersion),
      buildHash: notAvailable(release?.buildHash)
    },
    featureFlags: flags,
    timeline,
    logs: sortByTimestamp([...(logs?.entries ?? []), ...(logs?.recentErrors ?? [])]),
    evidence: sortByTimestamp(evidence),
    samplePayloadCandidate: logs?.samplePayload ?? networkExtraction.samplePayload ?? {},
    exactIds,
    openQuestions,
    expectedBehavior: buildExpectedBehavior(context, session?.network.length ?? 0),
    actualBehavior: buildActualBehavior(context),
    customerImpact: buildCustomerImpact(context)
  };
}
