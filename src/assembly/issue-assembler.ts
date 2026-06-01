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
}): { reproPack: ReproPack; markdown: string; issueDraft: IssueDraft } {
  const { ticket, reproPack, confidence, sanitizedPayload, openQuestions } = input;
  const markdown = `# ${reproPack.summary}

## Summary
${reproPack.summary}

## Customer complaint
${ticket.complaintText}

## Likely repro steps
${formatReproSteps(reproPack.reproSteps)}

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
