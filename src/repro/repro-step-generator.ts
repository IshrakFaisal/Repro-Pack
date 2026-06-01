import type { EnrichedContext, NormalizedEvidenceBundle, ReproStep } from "../types/schemas";
import { normalizeWhitespace, splitSentences, toSentenceCase } from "../utils/text";

const actionPattern = /\b(click|open|visit|load|submit|save|login|log in|upload|download|refresh|switch|toggle|filter|search|checkout|pay|export)\b/i;

function addUniqueStep(target: ReproStep[], nextStep: ReproStep): void {
  const normalized = nextStep.step.toLowerCase();
  if (target.some((existing) => existing.step.toLowerCase() === normalized)) {
    return;
  }

  target.push(nextStep);
}

export function generateReproSteps(
  context: EnrichedContext,
  normalized: NormalizedEvidenceBundle
): ReproStep[] {
  const steps: ReproStep[] = [];
  const userNarrative = [context.ticket.complaintText, ...context.ticket.supportAgentNotes].join(" ");

  for (const sentence of splitSentences(userNarrative)) {
    const cleaned = normalizeWhitespace(sentence.replace(/^customer says[:\s-]*/i, ""));
    if (!cleaned) {
      continue;
    }

    if (actionPattern.test(cleaned)) {
      addUniqueStep(steps, {
        step: toSentenceCase(cleaned),
        source: "user_report",
        confidence: 0.76
      });
    }
  }

  for (const event of context.session.data?.events ?? []) {
    let stepText: string | undefined;
    const detail = event.route ? `${event.detail} on ${event.route}` : event.detail;

    if (/page|view/i.test(event.type) && event.route) {
      stepText = `Open ${event.route}.`;
    } else if (/click|tap/i.test(event.type)) {
      stepText = `Click ${detail}.`;
    } else if (/submit|request/i.test(event.type)) {
      stepText = `Submit ${detail}.`;
    }

    if (stepText) {
      addUniqueStep(steps, {
        step: toSentenceCase(normalizeWhitespace(stepText)),
        source: "telemetry",
        confidence: 0.84
      });
    }
  }

  if (steps.length === 0) {
    const firstRoute = context.session.data?.events.find((event) => event.route)?.route;
    if (firstRoute) {
      addUniqueStep(steps, {
        step: `Inferred: Open ${firstRoute} and repeat the reported workflow.`,
        source: "inferred",
        confidence: 0.45
      });
    }
  }

  if (steps.length === 0 && normalized.featureFlags.length > 0) {
    addUniqueStep(steps, {
      step: `Inferred: Repeat the workflow with flag state ${normalized.featureFlags
        .map((flag) => `${flag.name}=${flag.variant}`)
        .join(", ")}.`,
      source: "inferred",
      confidence: 0.38
    });
  }

  if (steps.length === 0) {
    addUniqueStep(steps, {
      step: "Inferred: Repeat the workflow described in the support complaint.",
      source: "inferred",
      confidence: 0.3
    });
  }

  return steps.slice(0, 6);
}
