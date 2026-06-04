import type {
  ConfidenceScore,
  IssueDraft,
  ReproPack,
  ReproStep,
  SanitizedPayload,
  SupportTicket
} from "../types/schemas";
import { IssueDraftSchema, ReproPackSchema } from "../types/schemas";

function formatValue(value: string): string {
  return value || "not available";
}

function formatFeatureFlags(flags: ReproPack["featureFlags"]): string {
  if (flags.length === 0) {
    return "- not available";
  }

  return flags.map((flag) => `- \`${flag.name}\` = \`${flag.variant}\` (${flag.source})`).join("\n");
}

function formatReproSteps(reproSteps: ReproStep[]): string {
  return reproSteps
    .map((step, index) => `${index + 1}. ${step.step} [${step.source}, confidence=${step.confidence}]`)
    .join("\n");
}

function formatAlternativePaths(reproPack: ReproPack): string {
  if (reproPack.alternativeReproPaths.length === 0) {
    return "- not available";
  }

  return reproPack.alternativeReproPaths
    .map((path) => {
      const steps = path.steps.map((step, index) => `  ${index + 1}. ${step.step} [${step.source}, confidence=${step.confidence}]`).join("\n");
      return `- ${path.name} (confidence=${path.confidence}): ${path.rationale}\n${steps}`;
    })
    .join("\n");
}

function formatEnvironmentDeltas(reproPack: ReproPack): string {
  if (reproPack.environmentDeltas.length === 0) {
    return "- none detected";
  }

  return reproPack.environmentDeltas
    .map(
      (delta) =>
        `- ${delta.field}: ticket=\`${delta.ticketValue}\`, observed=\`${delta.observedValue}\`, risk=${delta.risk}. ${delta.reason}`
    )
    .join("\n");
}

function formatRedactionAudit(reproPack: ReproPack): string {
  if (!reproPack.redactionAuditReport) {
    return "- not available";
  }

  return [
    `- Report ID: ${reproPack.redactionAuditReport.reportId}`,
    `- Generated: ${reproPack.redactionAuditReport.generatedAt}`,
    `- Redactions: ${reproPack.redactionAuditReport.redactionCount}`,
    `- Classifications: ${JSON.stringify(reproPack.redactionAuditReport.classifications)}`,
    `- Checksum: ${reproPack.redactionAuditReport.checksum}`
  ].join("\n");
}

function formatLlmSuggestions(reproPack: ReproPack): string {
  if (!reproPack.llmSuggestions || reproPack.llmSuggestions.steps.length === 0) {
    return "- not available";
  }

  const header = `⚠ AI-suggested, not evidence-backed. Model: ${reproPack.llmSuggestions.model}. Generated: ${reproPack.llmSuggestions.generatedAt}`;
  return [
    header,
    ...reproPack.llmSuggestions.steps.map((step, index) => `${index + 1}. ${step}`)
  ].join("\n");
}

function formatTestScaffold(reproPack: ReproPack): string {
  const scaffold = reproPack.automatedTestScaffold;
  if (scaffold.skeleton.length === 0 && scaffold.assertions.length === 0) {
    return "- not available";
  }

  return [
    `- Framework: ${scaffold.framework}`,
    `- Language: ${scaffold.language}`,
    `- File hint: \`${scaffold.fileHint}\``,
    "",
    "```ts",
    ...scaffold.skeleton,
    "```",
    "",
    ...scaffold.assertions.map((assertion) => `- ${assertion}`)
  ].join("\n");
}

function formatSimilarBugHints(reproPack: ReproPack): string {
  if (reproPack.similarBugHints.length === 0) {
    return "- not available";
  }

  return reproPack.similarBugHints
    .map((hint) => `- ${hint.signal} (confidence=${hint.confidence}): ${hint.rationale}`)
    .join("\n");
}

function formatBlameAssignee(reproPack: ReproPack): string {
  const suggestion = reproPack.blameAssigneeSuggestion;
  return [
    `- Suggested assignee: ${suggestion.assignee}`,
    `- Confidence: ${suggestion.confidence}`,
    `- Rationale: ${suggestion.rationale}`,
    `- File hints: ${suggestion.files.length > 0 ? suggestion.files.map((file) => `\`${file}\``).join(", ") : "not available"}`
  ].join("\n");
}

function formatFixValidationChecklist(reproPack: ReproPack): string {
  if (reproPack.fixValidationChecklist.length === 0) {
    return "- not available";
  }

  return reproPack.fixValidationChecklist
    .map((item) => `- [ ] ${item.item} (${item.source})`)
    .join("\n");
}

function formatCustomerImpactScore(reproPack: ReproPack): string {
  const impact = reproPack.customerImpactScore;
  return [
    `- Score: ${impact.score}/100`,
    `- Affected tenants: ${impact.affectedTenantCount}`,
    `- Affected users: ${impact.affectedUserCount}`,
    `- Account tier: ${impact.accountTier}`,
    `- Recurrence: ${impact.recurrenceCount}`,
    `- Reasoning: ${impact.reasoning}`
  ].join("\n");
}

function formatTimeline(timeline: ReproPack["timeline"]): string {
  if (timeline.length === 0) {
    return "- not available";
  }

  return timeline
    .map((event) => `- ${event.timestamp} | ${event.source} | ${event.title} | ${event.detail}`)
    .join("\n");
}

function formatLogs(logs: ReproPack["logs"]): string {
  if (logs.length === 0) {
    return "- not available";
  }

  return logs
    .map((entry) => `- ${entry.timestamp} | ${entry.level.toUpperCase()} | ${entry.source} | ${entry.message}`)
    .join("\n");
}

function formatEvidence(reproPack: ReproPack): string {
  if (reproPack.evidence.length === 0) {
    return "- not available";
  }

  return reproPack.evidence
    .map(
      (item) =>
        `- ${item.summary} (${item.source}, confidence=${item.confidence}, citation=${item.citation}${item.conflict ? ", conflict=true" : ""})`
    )
    .join("\n");
}

function formatOpenQuestions(openQuestions: string[]): string {
  if (openQuestions.length === 0) {
    return "- none";
  }

  return openQuestions.map((question) => `- ${question}`).join("\n");
}

export function assembleArtifacts(input: {
  ticket: SupportTicket;
  reproPack: ReproPack;
  confidence: ConfidenceScore;
  sanitizedPayload: SanitizedPayload;
  openQuestions: string[];
  sanitizedComplaintText: string;
}): { reproPack: ReproPack; markdown: string; issueDraft: IssueDraft } {
  const { ticket, reproPack, confidence, sanitizedPayload, openQuestions, sanitizedComplaintText } = input;
  const markdown = `# ${reproPack.summary}

## Summary
${reproPack.summary}

## Customer complaint
${sanitizedComplaintText}

## Likely repro steps
${formatReproSteps(reproPack.reproSteps)}

## Minimal repro sequence
${formatReproSteps(reproPack.minimalReproSequence)}

## Alternative repro paths
${formatAlternativePaths(reproPack)}

## AI-suggested step overlay
${formatLlmSuggestions(reproPack)}

## Automated test scaffold
${formatTestScaffold(reproPack)}

## Similar bug dedupe hints
${formatSimilarBugHints(reproPack)}

## Blame-based assignee suggestion
${formatBlameAssignee(reproPack)}

## Fix validation checklist
${formatFixValidationChecklist(reproPack)}

## Customer impact score
${formatCustomerImpactScore(reproPack)}

## Expected vs actual
- Expected: ${reproPack.expectedBehavior}
- Actual: ${reproPack.actualBehavior}

## Environment
- Browser: ${formatValue(reproPack.environment.browser)}
- Browser version: ${formatValue(reproPack.environment.browserVersion)}
- Device: ${formatValue(reproPack.environment.device)}
- OS: ${formatValue(reproPack.environment.os)}
- App version: ${formatValue(reproPack.environment.appVersion)}
- Build hash: ${formatValue(reproPack.environment.buildHash)}

## Environment deltas
${formatEnvironmentDeltas(reproPack)}

## Regression classification
- Classification: ${reproPack.regressionClassification.classification}
- Reasoning: ${reproPack.regressionClassification.reasoning}
- Signals: ${reproPack.regressionClassification.signals.length > 0 ? reproPack.regressionClassification.signals.join(", ") : "not available"}

## Feature flags
${formatFeatureFlags(reproPack.featureFlags)}

## Timeline
${formatTimeline(reproPack.timeline)}

## Logs and errors
${formatLogs(reproPack.logs)}

## Sanitized sample payload
\`\`\`json
${JSON.stringify(sanitizedPayload.payload, null, 2)}
\`\`\`

## Evidence and confidence
- Overall confidence: ${confidence.overall}
- Reasoning: ${confidence.reasoning}
${formatEvidence(reproPack)}

## Redaction audit report
${formatRedactionAudit(reproPack)}

## Compliance
- Data residency mode: ${reproPack.compliance.dataResidencyMode}
- LLM used: ${reproPack.compliance.llmUsed}
- Customer consent required: ${reproPack.compliance.customerConsentRequired}
- Customer consent confirmed: ${reproPack.compliance.customerConsentConfirmed}

## Open questions
${formatOpenQuestions(openQuestions)}
`;

  const issueDraft = IssueDraftSchema.parse({
    ticketId: ticket.ticketId,
    title: `[repro-pack] ${ticket.ticketId}: ${reproPack.summary}`,
    body: markdown,
    labels: ["support", "bug", "repro-pack"]
  });

  return {
    reproPack: ReproPackSchema.parse(reproPack),
    markdown,
    issueDraft
  };
}
