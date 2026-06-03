import type { IssueTarget } from "../types/integrations";
import type { AuthActor } from "../auth/auth";
import type { MetricsRegistry } from "../observability/metrics";
import type { ProviderSet } from "../providers/interfaces";
import { ReproStore } from "../persistence/store";

export async function syncIssuesForPack(input: {
  tenantId: string;
  ticketId: string;
  providers: ProviderSet;
  store: ReproStore;
  targets: IssueTarget[];
  dryRun: boolean;
  actor?: AuthActor;
  metrics?: MetricsRegistry;
}) {
  const pack = await input.store.getPack(input.ticketId, input.tenantId);
  if (!pack) {
    throw new Error(`Repro pack not found for ticket ${input.ticketId}`);
  }

  if (!input.dryRun && pack.status !== "approved") {
    throw new Error("External issue sync requires an approved repro pack unless dry-run is enabled");
  }

  const ticket = pack.reproPack
    ? {
        ticketId: pack.ticketId,
        complaintText: pack.reproPack.actualBehavior,
        timestamps: {},
        attachments: [],
        supportAgentNotes: [],
        tags: [],
        customFields: {},
        source: {}
      }
    : undefined;

  if (!ticket) {
    throw new Error("Stored ticket context is not available for issue sync");
  }

  const results = [];
  for (const target of input.targets) {
    const tracker = input.providers.issueTrackers[target];
    if (!tracker) {
      results.push({
        target,
        status: "preview",
        externalId: "not configured",
        externalKey: `missing:${target}:${input.ticketId}`,
        syncedAt: new Date().toISOString(),
        idempotencyKey: `${target}:${input.tenantId}:${input.ticketId}`
      });
      continue;
    }

    const existingLink = pack.issueLinks.find((link) => link.target === target);
    const synced = await tracker.sync({
      tenantId: input.tenantId,
      ticket,
      issueDraft: pack.issueDraft,
      existingLink,
      dryRun: input.dryRun
    });

    if (!input.dryRun) {
      await input.store.saveIssueLink({
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        link: synced
      });
      await input.store.recordAuditEvent({
        tenantId: input.tenantId,
        ticketId: input.ticketId,
        action: `issue.sync.${target}`,
        outcome: "success",
        actor: input.actor,
        metadata: { status: synced.status, externalId: synced.externalId }
      });
    }

    input.metrics?.increment("repro_issue_sync_total", "External issue sync attempts", {
      tenant_id: input.tenantId,
      target,
      status: synced.status
    });

    results.push(synced);
  }

  return results;
}
