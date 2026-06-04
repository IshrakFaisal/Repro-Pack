import { createHash } from "node:crypto";
import type {
  EnrichedContext,
  EnvironmentDelta,
  NormalizedEvidenceBundle,
  RedactionAuditReport,
  RegressionClassification,
  ReproPath,
  ReproStep,
  SanitizationReportItem
} from "../types/schemas";

function normalizeStepKey(step: ReproStep): string {
  return step.step.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildMinimalReproSequence(steps: ReproStep[]): ReproStep[] {
  const seen = new Set<string>();
  const ordered = steps
    .filter((step) => {
      const key = normalizeStepKey(step);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const sourceWeight = { telemetry: 0, user_report: 1, inferred: 2 };
      return sourceWeight[left.source] - sourceWeight[right.source] || right.confidence - left.confidence;
    });

  const evidenceBacked = ordered.filter((step) => step.source !== "inferred");
  return (evidenceBacked.length > 0 ? evidenceBacked : ordered).slice(0, 4);
}

export function buildAlternativeReproPaths(
  context: EnrichedContext,
  normalized: NormalizedEvidenceBundle,
  primarySteps: ReproStep[]
): ReproPath[] {
  const paths: ReproPath[] = [];
  const telemetrySteps = primarySteps.filter((step) => step.source === "telemetry");
  const userSteps = primarySteps.filter((step) => step.source === "user_report");

  if (telemetrySteps.length > 0) {
    paths.push({
      name: "Telemetry path",
      steps: telemetrySteps,
      rationale: "Uses observed session events and network activity as the shortest evidence-backed route.",
      confidence: Math.min(0.95, telemetrySteps.reduce((total, step) => total + step.confidence, 0) / telemetrySteps.length)
    });
  }

  if (userSteps.length > 0) {
    paths.push({
      name: "User narrative path",
      steps: userSteps,
      rationale: "Keeps the reported customer workflow intact for cases where session replay is incomplete.",
      confidence: Math.min(0.85, userSteps.reduce((total, step) => total + step.confidence, 0) / userSteps.length)
    });
  }

  if (normalized.featureFlags.length > 0) {
    paths.push({
      name: "Flag-state path",
      steps: [
        {
          step: `Repeat the primary workflow with ${normalized.featureFlags
            .map((flag) => `${flag.name}=${flag.variant}`)
            .join(", ")}.`,
          source: "inferred",
          confidence: 0.58
        }
      ],
      rationale: "Feature flag state was captured and may be needed to reproduce the same behavior.",
      confidence: 0.58
    });
  }

  if (paths.length === 0 && primarySteps.length > 0) {
    paths.push({
      name: "Primary path",
      steps: primarySteps,
      rationale: "Only one viable path was available from the captured evidence.",
      confidence: primarySteps[0]?.confidence ?? 0.3
    });
  }

  return paths.slice(0, 3).map((path, index) => ({
    ...path,
    name: `${index + 1}. ${path.name}`
  }));
}

function stringFromRaw(raw: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = raw?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function detectEnvironmentDeltas(context: EnrichedContext, normalized: NormalizedEvidenceBundle): EnvironmentDelta[] {
  const deltas: EnvironmentDelta[] = [];
  const raw = context.ticket.rawSource;
  const comparisons = [
    { field: "browserVersion", ticketValue: stringFromRaw(raw, "browserVersion"), observedValue: normalized.environment.browserVersion },
    { field: "appVersion", ticketValue: stringFromRaw(raw, "appVersion"), observedValue: normalized.environment.appVersion },
    { field: "buildHash", ticketValue: stringFromRaw(raw, "buildHash"), observedValue: normalized.environment.buildHash },
    { field: "os", ticketValue: stringFromRaw(raw, "os"), observedValue: normalized.environment.os },
    { field: "device", ticketValue: stringFromRaw(raw, "device"), observedValue: normalized.environment.device }
  ];

  for (const comparison of comparisons) {
    if (!comparison.ticketValue || comparison.observedValue === "not available" || comparison.ticketValue === comparison.observedValue) {
      continue;
    }

    deltas.push({
      field: comparison.field,
      ticketValue: comparison.ticketValue,
      observedValue: comparison.observedValue,
      risk: ["appVersion", "buildHash"].includes(comparison.field) ? "high" : "medium",
      reason: `Ticket metadata and provider evidence disagree for ${comparison.field}.`
    });
  }

  return deltas;
}

export function classifyRegression(
  context: EnrichedContext,
  normalized: NormalizedEvidenceBundle,
  deltas: EnvironmentDelta[]
): RegressionClassification {
  const signals = new Set<string>();
  const tags = context.ticket.tags.map((tag) => tag.toLowerCase());

  if (tags.some((tag) => tag.includes("regression"))) {
    signals.add("ticket tagged as regression");
  }
  if (deltas.some((delta) => ["appVersion", "buildHash"].includes(delta.field))) {
    signals.add("release/build environment delta detected");
  }
  if (normalized.featureFlags.length > 0) {
    signals.add("feature flag state captured");
  }
  if (context.release.data?.deployedAt && context.ticket.timestamps.createdAt) {
    const deployedAt = new Date(context.release.data.deployedAt).getTime();
    const createdAt = new Date(context.ticket.timestamps.createdAt).getTime();
    if (Number.isFinite(deployedAt) && Number.isFinite(createdAt) && Math.abs(createdAt - deployedAt) < 7 * 24 * 60 * 60 * 1000) {
      signals.add("ticket occurred within seven days of deployment");
    }
  }

  if ([...signals].some((signal) => signal.includes("regression") || signal.includes("release") || signal.includes("deployment"))) {
    return {
      classification: "likely_regression",
      reasoning: "Release, deployment, or explicit regression signals were found in the repro evidence.",
      signals: [...signals]
    };
  }

  if (normalized.evidence.some((item) => item.type === "network" || item.type === "log")) {
    return {
      classification: "likely_new_bug",
      reasoning: "Failure evidence exists, but no release or history signal ties it to a regression.",
      signals: [...signals, "failure evidence without regression signal"]
    };
  }

  return {
    classification: "unknown",
    reasoning: "Not enough release, flag, or history evidence was available to classify the issue.",
    signals: [...signals]
  };
}

export function buildRedactionAuditReport(ticketId: string, report: SanitizationReportItem[]): RedactionAuditReport {
  const classifications = report.reduce<Record<string, number>>((totals, item) => {
    totals[item.classification] = (totals[item.classification] ?? 0) + 1;
    return totals;
  }, {});
  const checksum = createHash("sha256")
    .update(JSON.stringify({ ticketId, classifications, redactionCount: report.length }))
    .digest("hex");

  return {
    reportId: `redaction-${ticketId}-${checksum.slice(0, 12)}`,
    ticketId,
    generatedAt: new Date().toISOString(),
    redactionCount: report.length,
    classifications,
    checksum
  };
}
