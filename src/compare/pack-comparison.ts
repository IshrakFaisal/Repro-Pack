import type { ReproPack, StoredReproPack } from "../types/schemas";

export type PackComparison = {
  left: {
    tenantId: string;
    ticketId: string;
    summary: string;
  };
  right: {
    tenantId: string;
    ticketId: string;
    summary: string;
  };
  confidenceDelta: number;
  impactDelta: number;
  duplicateLikelihood: number;
  sharedFeatureFlags: Array<{
    name: string;
    leftVariant: string;
    rightVariant: string;
    sameVariant: boolean;
  }>;
  environmentDifferences: Array<{
    field: keyof ReproPack["environment"];
    left: string;
    right: string;
  }>;
  sharedSignals: string[];
  stepOverlap: {
    sharedStepCount: number;
    leftStepCount: number;
    rightStepCount: number;
  };
  recommendation: string;
};

const environmentFields: Array<keyof ReproPack["environment"]> = [
  "browser",
  "browserVersion",
  "device",
  "os",
  "appVersion",
  "buildHash"
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function compareFeatureFlags(left: ReproPack, right: ReproPack): PackComparison["sharedFeatureFlags"] {
  return left.featureFlags
    .map((leftFlag) => {
      const rightFlag = right.featureFlags.find((flag) => flag.name === leftFlag.name);
      if (!rightFlag) {
        return undefined;
      }

      return {
        name: leftFlag.name,
        leftVariant: leftFlag.variant,
        rightVariant: rightFlag.variant,
        sameVariant: leftFlag.variant === rightFlag.variant
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function compareEnvironment(left: ReproPack, right: ReproPack): PackComparison["environmentDifferences"] {
  return environmentFields
    .map((field) => ({
      field,
      left: left.environment[field],
      right: right.environment[field]
    }))
    .filter((entry) => entry.left !== entry.right);
}

function buildSharedSignals(left: ReproPack, right: ReproPack): string[] {
  const leftSignals = new Set([
    ...left.logs.map((log) => log.errorCode).filter((value): value is string => Boolean(value)),
    ...left.regressionClassification.signals,
    left.regressionClassification.classification
  ]);
  const rightSignals = new Set([
    ...right.logs.map((log) => log.errorCode).filter((value): value is string => Boolean(value)),
    ...right.regressionClassification.signals,
    right.regressionClassification.classification
  ]);

  return [...leftSignals].filter((signal) => rightSignals.has(signal)).sort();
}

function stepOverlap(left: ReproPack, right: ReproPack): PackComparison["stepOverlap"] {
  const leftSteps = left.reproSteps.map((step) => normalizeText(step.step)).filter(Boolean);
  const rightSteps = new Set(right.reproSteps.map((step) => normalizeText(step.step)).filter(Boolean));
  const sharedStepCount = leftSteps.filter((step) => rightSteps.has(step)).length;

  return {
    sharedStepCount,
    leftStepCount: left.reproSteps.length,
    rightStepCount: right.reproSteps.length
  };
}

function likelihood(input: {
  sharedFeatureFlags: PackComparison["sharedFeatureFlags"];
  environmentDifferences: PackComparison["environmentDifferences"];
  sharedSignals: string[];
  stepOverlap: PackComparison["stepOverlap"];
  left: ReproPack;
  right: ReproPack;
}): number {
  let score = 0.1;
  score += Math.min(0.25, input.sharedSignals.length * 0.08);
  score += Math.min(0.2, input.sharedFeatureFlags.filter((flag) => flag.sameVariant).length * 0.08);
  score += Math.min(0.25, input.stepOverlap.sharedStepCount * 0.08);
  if (input.left.regressionClassification.classification === input.right.regressionClassification.classification) {
    score += 0.12;
  }
  if (input.environmentDifferences.length === 0) {
    score += 0.08;
  }

  return Math.min(1, round(score));
}

function recommendation(duplicateLikelihood: number, environmentDifferences: PackComparison["environmentDifferences"]): string {
  if (duplicateLikelihood >= 0.75) {
    return "Likely duplicate or tightly related issue. Link before creating a separate engineering task.";
  }
  if (duplicateLikelihood >= 0.45) {
    return environmentDifferences.length > 0
      ? "Related issue with environment differences. Compare deployment, browser, and flag state before merging."
      : "Possibly related issue. Review shared signals and repro steps before merging.";
  }
  return "Low duplicate signal. Treat as separate unless external investigation finds a shared root cause.";
}

export function compareReproPacks(left: StoredReproPack, right: StoredReproPack): PackComparison {
  const sharedFeatureFlags = compareFeatureFlags(left.reproPack, right.reproPack);
  const environmentDifferences = compareEnvironment(left.reproPack, right.reproPack);
  const sharedSignals = buildSharedSignals(left.reproPack, right.reproPack);
  const overlap = stepOverlap(left.reproPack, right.reproPack);
  const duplicateLikelihood = likelihood({
    sharedFeatureFlags,
    environmentDifferences,
    sharedSignals,
    stepOverlap: overlap,
    left: left.reproPack,
    right: right.reproPack
  });

  return {
    left: {
      tenantId: left.tenantId,
      ticketId: left.ticketId,
      summary: left.reproPack.summary
    },
    right: {
      tenantId: right.tenantId,
      ticketId: right.ticketId,
      summary: right.reproPack.summary
    },
    confidenceDelta: round(left.reproPack.confidence.overall - right.reproPack.confidence.overall),
    impactDelta: left.reproPack.customerImpactScore.score - right.reproPack.customerImpactScore.score,
    duplicateLikelihood,
    sharedFeatureFlags,
    environmentDifferences,
    sharedSignals,
    stepOverlap: overlap,
    recommendation: recommendation(duplicateLikelihood, environmentDifferences)
  };
}
