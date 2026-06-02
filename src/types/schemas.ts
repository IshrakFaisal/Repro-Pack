import { z } from "zod";
import { IssueLinkSchema } from "./integrations";

export const ProviderStatusSchema = z.enum(["success", "unavailable", "error"]);

export const AttachmentSchema = z.object({
  name: z.string(),
  type: z.string().default("unknown"),
  url: z.string().optional(),
  description: z.string().optional()
});

export const TimestampFieldsSchema = z.object({
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  occurredAt: z.string().optional()
});

export const SupportTicketSchema = z.object({
  ticketId: z.string().min(1),
  complaintText: z.string().min(1),
  userId: z.string().optional(),
  accountId: z.string().optional(),
  workspaceId: z.string().optional(),
  timestamps: TimestampFieldsSchema.default({}),
  attachments: z.array(AttachmentSchema).default([]),
  supportAgentNotes: z.array(z.string()).default([]),
  severity: z.string().optional(),
  priority: z.string().optional(),
  expectedBehavior: z.string().optional(),
  actualBehavior: z.string().optional(),
  source: z
    .object({
      platform: z.string().optional(),
      externalId: z.string().optional()
    })
    .default({}),
  rawSource: z.record(z.unknown()).optional()
});

export const TimelineEventSchema = z.object({
  timestamp: z.string(),
  source: z.string(),
  title: z.string(),
  detail: z.string(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  relatedIds: z.array(z.string()).default([])
});

export const LogEntrySchema = z.object({
  timestamp: z.string(),
  level: z.string(),
  source: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  errorCode: z.string().optional(),
  metadata: z.record(z.unknown()).default({})
});

export const FeatureFlagSchema = z.object({
  name: z.string(),
  variant: z.string(),
  source: z.string(),
  reason: z.string().optional()
});

export const ReleaseInfoSchema = z.object({
  appVersion: z.string().optional(),
  buildHash: z.string().optional(),
  releaseIdentifier: z.string().optional(),
  deployedAt: z.string().optional(),
  source: z.string().default("release-provider")
});

export const SessionEventSchema = z.object({
  timestamp: z.string(),
  type: z.string(),
  detail: z.string(),
  route: z.string().optional()
});

export const NetworkRequestSchema = z.object({
  timestamp: z.string(),
  method: z.string(),
  url: z.string(),
  status: z.number().optional(),
  requestId: z.string().optional(),
  traceId: z.string().optional(),
  responseSummary: z.string().optional(),
  payload: z.unknown().optional()
});

export const SessionContextSchema = z.object({
  sessionId: z.string().optional(),
  browser: z.string().optional(),
  browserVersion: z.string().optional(),
  device: z.string().optional(),
  os: z.string().optional(),
  replayUrl: z.string().optional(),
  events: z.array(SessionEventSchema).default([]),
  network: z.array(NetworkRequestSchema).default([])
});

export const LogsContextSchema = z.object({
  entries: z.array(LogEntrySchema).default([]),
  recentErrors: z.array(LogEntrySchema).default([]),
  samplePayload: z.unknown().optional()
});

export const FeatureFlagContextSchema = z.object({
  flags: z.array(FeatureFlagSchema).default([])
});

export const EvidenceItemSchema = z.object({
  type: z.string(),
  source: z.string(),
  timestamp: z.string().optional(),
  summary: z.string(),
  detail: z.string(),
  confidence: z.number().min(0).max(1),
  citation: z.string(),
  relatedIds: z.array(z.string()).default([]),
  conflict: z.boolean().default(false)
});

export const ProviderResultSchema = z.object({
  provider: z.string(),
  status: ProviderStatusSchema,
  fetchedAt: z.string(),
  latencyMs: z.number().nonnegative(),
  errorSummary: z.string().optional(),
  data: z.unknown().optional()
});

export const SanitizationReportItemSchema = z.object({
  location: z.string(),
  redactionType: z.string(),
  classification: z.string(),
  replacementStrategy: z.string()
});

export const ReproStepSchema = z.object({
  step: z.string(),
  source: z.enum(["user_report", "telemetry", "inferred"]),
  confidence: z.number().min(0).max(1)
});

export const ConfidenceScoreSchema = z.object({
  overall: z.number().min(0).max(1),
  reasoning: z.string(),
  factors: z.array(z.string()).default([])
});

export const EnvironmentSchema = z.object({
  browser: z.string(),
  browserVersion: z.string(),
  device: z.string(),
  os: z.string(),
  appVersion: z.string(),
  buildHash: z.string()
});

export const ReproPackSchema = z.object({
  ticketId: z.string(),
  summary: z.string(),
  customerImpact: z.string(),
  reproSteps: z.array(ReproStepSchema),
  expectedBehavior: z.string(),
  actualBehavior: z.string(),
  environment: EnvironmentSchema,
  featureFlags: z.array(FeatureFlagSchema),
  timeline: z.array(TimelineEventSchema),
  logs: z.array(LogEntrySchema),
  samplePayload: z.unknown(),
  sanitizationReport: z.array(SanitizationReportItemSchema),
  evidence: z.array(EvidenceItemSchema),
  confidence: ConfidenceScoreSchema
});

export const IssueDraftSchema = z.object({
  ticketId: z.string(),
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()).default([])
});

export const ReviewStatusSchema = z.enum(["draft", "reviewed", "approved", "rejected"]);

export const ReviewDecisionSchema = z.object({
  status: ReviewStatusSchema,
  reviewer: z.string().default("not available"),
  note: z.string().default("not available"),
  createdAt: z.string()
});

export const StoredReproPackSchema = z.object({
  tenantId: z.string().default("default"),
  ticketId: z.string(),
  status: ReviewStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  dryRun: z.boolean(),
  sourceLookup: z
    .object({
      fixtureId: z.string().optional(),
      ticketPath: z.string().optional(),
      supportTicketId: z.string().optional()
    })
    .default({}),
  reproPack: ReproPackSchema,
  issueDraft: IssueDraftSchema,
  markdown: z.string(),
  providerResults: z
    .object({
      session: ProviderResultSchema.optional(),
      logs: ProviderResultSchema.optional(),
      featureFlags: ProviderResultSchema.optional(),
      release: ProviderResultSchema.optional()
    })
    .default({}),
  issueLinks: z.array(IssueLinkSchema).default([]),
  reviewHistory: z.array(ReviewDecisionSchema).default([])
});

export const ProcessingJobStatusSchema = z.enum(["queued", "running", "succeeded", "failed"]);

export const ProcessingJobSchema = z.object({
  jobId: z.string(),
  status: ProcessingJobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  tenantId: z.string().default("default"),
  dryRun: z.boolean(),
  writeArtifacts: z.boolean(),
  ticketId: z.string().optional(),
  sourceLookup: z
    .object({
      fixtureId: z.string().optional(),
      ticketPath: z.string().optional(),
      supportTicketId: z.string().optional()
    })
    .default({}),
  error: z.string().optional()
});

export type SupportTicket = z.infer<typeof SupportTicketSchema>;
export type TimelineEvent = z.infer<typeof TimelineEventSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
export type ReleaseInfo = z.infer<typeof ReleaseInfoSchema>;
export type SessionContext = z.infer<typeof SessionContextSchema>;
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>;
export type LogsContext = z.infer<typeof LogsContextSchema>;
export type FeatureFlagContext = z.infer<typeof FeatureFlagContextSchema>;
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type ProviderResult = z.infer<typeof ProviderResultSchema>;
export type SanitizationReportItem = z.infer<typeof SanitizationReportItemSchema>;
export type ReproStep = z.infer<typeof ReproStepSchema>;
export type ConfidenceScore = z.infer<typeof ConfidenceScoreSchema>;
export type ReproPack = z.infer<typeof ReproPackSchema>;
export type IssueDraft = z.infer<typeof IssueDraftSchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
export type StoredReproPack = z.infer<typeof StoredReproPackSchema>;
export type ProcessingJob = z.infer<typeof ProcessingJobSchema>;

export type ProviderResultOf<T> = Omit<ProviderResult, "data"> & {
  data?: T;
};

export type EnrichedContext = {
  ticket: SupportTicket;
  session: ProviderResultOf<SessionContext>;
  logs: ProviderResultOf<LogsContext>;
  featureFlags: ProviderResultOf<FeatureFlagContext>;
  release: ProviderResultOf<ReleaseInfo>;
};

export type SanitizedPayload = {
  payload: unknown;
  report: SanitizationReportItem[];
};

export type NormalizedEvidenceBundle = {
  environment: z.infer<typeof EnvironmentSchema>;
  featureFlags: FeatureFlag[];
  timeline: TimelineEvent[];
  logs: LogEntry[];
  evidence: EvidenceItem[];
  samplePayloadCandidate: unknown;
  exactIds: string[];
  openQuestions: string[];
  expectedBehavior: string;
  actualBehavior: string;
  customerImpact: string;
};
