import type { AuditEvent } from "../types/integrations";
import type { StoredReproPack } from "../types/schemas";

export type AnalyticsSummary = {
  generatedAt: string;
  tenantId?: string;
  packCount: number;
  confidenceTrend: Array<{
    date: string;
    packCount: number;
    averageConfidence: number;
  }>;
  supportToCloseCycle: {
    closedPackCount: number;
    averageHours: number | null;
    samples: Array<{
      ticketId: string;
      startAt: string;
      closedAt: string;
      hours: number;
      closeSignal: "issue_sync" | "approval";
    }>;
  };
  featureFlagCorrelation: Array<{
    flag: string;
    variant: string;
    packCount: number;
    regressionCount: number;
    averageConfidence: number;
    averageImpactScore: number;
  }>;
  customerImpact: {
    averageScore: number | null;
    topPacks: Array<{
      tenantId: string;
      ticketId: string;
      summary: string;
      score: number;
      affectedTenantCount: number;
      affectedUserCount: number;
      accountTier: string;
    }>;
  };
  auditOutcomes: Array<{
    action: string;
    success: number;
    error: number;
  }>;
};

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function dayKey(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function hoursBetween(start: string, end: string): number {
  return round((new Date(end).getTime() - new Date(start).getTime()) / (60 * 60 * 1000));
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return round(values.reduce((total, value) => total + value, 0) / values.length);
}

function buildConfidenceTrend(packs: StoredReproPack[]): AnalyticsSummary["confidenceTrend"] {
  const groups = new Map<string, number[]>();
  for (const pack of packs) {
    const key = dayKey(pack.createdAt);
    groups.set(key, [...(groups.get(key) ?? []), pack.reproPack.confidence.overall]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date,
      packCount: values.length,
      averageConfidence: average(values) ?? 0
    }));
}

function buildSupportToCloseCycle(packs: StoredReproPack[]): AnalyticsSummary["supportToCloseCycle"] {
  const samples = packs
    .map((pack) => {
      const firstSync = [...pack.issueLinks].sort((left, right) => left.syncedAt.localeCompare(right.syncedAt))[0];
      if (firstSync) {
        return {
          ticketId: pack.ticketId,
          startAt: pack.createdAt,
          closedAt: firstSync.syncedAt,
          hours: hoursBetween(pack.createdAt, firstSync.syncedAt),
          closeSignal: "issue_sync" as const
        };
      }

      const approval = pack.reviewHistory.find((review) => review.status === "approved");
      if (approval) {
        return {
          ticketId: pack.ticketId,
          startAt: pack.createdAt,
          closedAt: approval.createdAt,
          hours: hoursBetween(pack.createdAt, approval.createdAt),
          closeSignal: "approval" as const
        };
      }

      return undefined;
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample));

  return {
    closedPackCount: samples.length,
    averageHours: average(samples.map((sample) => sample.hours)),
    samples
  };
}

function buildFeatureFlagCorrelation(packs: StoredReproPack[]): AnalyticsSummary["featureFlagCorrelation"] {
  const groups = new Map<string, StoredReproPack[]>();
  for (const pack of packs) {
    for (const flag of pack.reproPack.featureFlags) {
      const key = `${flag.name}\u0000${flag.variant}`;
      groups.set(key, [...(groups.get(key) ?? []), pack]);
    }
  }

  return [...groups.entries()]
    .map(([key, groupedPacks]) => {
      const [flag = "not available", variant = "not available"] = key.split("\u0000");
      return {
        flag,
        variant,
        packCount: groupedPacks.length,
        regressionCount: groupedPacks.filter((pack) => pack.reproPack.regressionClassification.classification === "likely_regression").length,
        averageConfidence: average(groupedPacks.map((pack) => pack.reproPack.confidence.overall)) ?? 0,
        averageImpactScore: average(groupedPacks.map((pack) => pack.reproPack.customerImpactScore.score)) ?? 0
      };
    })
    .sort((left, right) => right.packCount - left.packCount || right.averageImpactScore - left.averageImpactScore);
}

function buildAuditOutcomes(events: AuditEvent[]): AnalyticsSummary["auditOutcomes"] {
  const groups = new Map<string, { success: number; error: number }>();
  for (const event of events) {
    const current = groups.get(event.action) ?? { success: 0, error: 0 };
    current[event.outcome] += 1;
    groups.set(event.action, current);
  }

  return [...groups.entries()]
    .map(([action, counts]) => ({
      action,
      success: counts.success,
      error: counts.error
    }))
    .sort((left, right) => left.action.localeCompare(right.action));
}

export function buildAnalyticsSummary(input: {
  tenantId?: string;
  packs: StoredReproPack[];
  auditEvents: AuditEvent[];
}): AnalyticsSummary {
  const impactScores = input.packs.map((pack) => pack.reproPack.customerImpactScore.score);

  return {
    generatedAt: new Date().toISOString(),
    tenantId: input.tenantId,
    packCount: input.packs.length,
    confidenceTrend: buildConfidenceTrend(input.packs),
    supportToCloseCycle: buildSupportToCloseCycle(input.packs),
    featureFlagCorrelation: buildFeatureFlagCorrelation(input.packs),
    customerImpact: {
      averageScore: average(impactScores),
      topPacks: [...input.packs]
        .sort((left, right) => right.reproPack.customerImpactScore.score - left.reproPack.customerImpactScore.score)
        .slice(0, 10)
        .map((pack) => ({
          tenantId: pack.tenantId,
          ticketId: pack.ticketId,
          summary: pack.reproPack.summary,
          score: pack.reproPack.customerImpactScore.score,
          affectedTenantCount: pack.reproPack.customerImpactScore.affectedTenantCount,
          affectedUserCount: pack.reproPack.customerImpactScore.affectedUserCount,
          accountTier: pack.reproPack.customerImpactScore.accountTier
        }))
    },
    auditOutcomes: buildAuditOutcomes(input.auditEvents)
  };
}
