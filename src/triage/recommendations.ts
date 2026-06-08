import type { StoredReproPack } from "../types/schemas";

export type TriageRecommendation = {
  tenantId: string;
  ticketId: string;
  status: StoredReproPack["status"];
  summary: string;
  score: number;
  confidence: number;
  customerImpactScore: number;
  regression: StoredReproPack["reproPack"]["regressionClassification"]["classification"];
  reasons: string[];
  updatedAt: string;
};

function computeTriageScore(pack: StoredReproPack): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = pack.reproPack.customerImpactScore.score;

  if (pack.status === "draft") {
    score += 15;
    reasons.push("awaiting review");
  }
  if (pack.status === "rejected") {
    score -= 30;
    reasons.push("rejected pack");
  }
  if (pack.reproPack.regressionClassification.classification === "likely_regression") {
    score += 20;
    reasons.push("likely regression");
  }
  if (pack.reproPack.confidence.overall >= 0.8) {
    score += 10;
    reasons.push("high confidence");
  }
  if (pack.reproPack.featureFlags.length > 0) {
    score += 5;
    reasons.push("feature flag state captured");
  }
  if (pack.issueLinks.length === 0 && pack.status === "approved") {
    score += 8;
    reasons.push("approved but not synced");
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: reasons.length > 0 ? reasons : ["normal priority"]
  };
}

export function buildTriageRecommendations(input: {
  packs: StoredReproPack[];
  status?: StoredReproPack["status"];
  limit?: number;
}): TriageRecommendation[] {
  return input.packs
    .filter((pack) => !input.status || pack.status === input.status)
    .map((pack) => {
      const triage = computeTriageScore(pack);
      return {
        tenantId: pack.tenantId,
        ticketId: pack.ticketId,
        status: pack.status,
        summary: pack.reproPack.summary,
        score: triage.score,
        confidence: pack.reproPack.confidence.overall,
        customerImpactScore: pack.reproPack.customerImpactScore.score,
        regression: pack.reproPack.regressionClassification.classification,
        reasons: triage.reasons,
        updatedAt: pack.updatedAt
      };
    })
    .sort((left, right) => right.score - left.score || right.confidence - left.confidence || right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, input.limit ?? 20);
}
