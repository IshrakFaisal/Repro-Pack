import type { EnrichedContext, NormalizedEvidenceBundle, ReproStep, SanitizedPayload } from "../types/schemas";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function scoreConfidence(params: {
  context: EnrichedContext;
  normalized: NormalizedEvidenceBundle;
  reproSteps: ReproStep[];
  sanitizedPayload: SanitizedPayload;
}) {
  const { context, normalized, reproSteps, sanitizedPayload } = params;
  const successfulProviders = [
    context.session.status,
    context.logs.status,
    context.featureFlags.status,
    context.release.status
  ].filter((status) => status === "success").length;
  const corroboration = Math.min(successfulProviders / 4, 1) * 0.25;
  const exactIdScore = (Math.min(normalized.exactIds.length, 4) / 4) * 0.2;
  const environmentValues = Object.values(normalized.environment).filter((value) => value !== "not available").length;
  const environmentScore = (environmentValues / 6) * 0.15;
  const traceCorrelation =
    normalized.logs.some((entry) => entry.requestId && entry.traceId) ||
    normalized.evidence.some((item) => item.type === "network" && item.relatedIds.length > 0)
      ? 0.15
      : 0;
  const payloadScore =
    sanitizedPayload.payload && JSON.stringify(sanitizedPayload.payload) !== "{}" ? 0.1 : 0;
  const reproScore =
    (reproSteps.reduce((sum, step) => sum + step.confidence, 0) / Math.max(reproSteps.length, 1)) * 0.1;
  const sanitizerScore = 0.05;
  const overall = clamp(
    corroboration + exactIdScore + environmentScore + traceCorrelation + payloadScore + reproScore + sanitizerScore
  );

  const factors = [
    `Corroborating providers: ${successfulProviders}/4 (+${corroboration.toFixed(2)})`,
    `Exact identifiers captured: ${normalized.exactIds.length} (+${exactIdScore.toFixed(2)})`,
    `Environment completeness: ${environmentValues}/6 (+${environmentScore.toFixed(2)})`,
    `Trace or request correlation: ${traceCorrelation > 0 ? "present" : "missing"} (+${traceCorrelation.toFixed(2)})`,
    `Payload completeness: ${payloadScore > 0 ? "present" : "missing"} (+${payloadScore.toFixed(2)})`,
    `Average repro-step confidence: ${(reproScore / 0.1).toFixed(2)} (+${reproScore.toFixed(2)})`,
    `Sanitizer completed with ${sanitizedPayload.report.length} actions (+${sanitizerScore.toFixed(2)})`
  ];

  return {
    overall: round(overall),
    reasoning: factors.join("; "),
    factors
  };
}
