import path from "node:path";
import { ConfidenceScoreSchema, ReproPackSchema } from "../types/schemas";
import { ingestTicket } from "../ingestion/ticket-ingestion";
import { enrichContext } from "../enrichment/context-enrichment";
import { normalizeEvidence } from "../normalization/evidence-normalizer";
import { sanitizePayload } from "../sanitizer/sanitizer";
import { generateReproSteps } from "../repro/repro-step-generator";
import { scoreConfidence } from "../scoring/confidence-scorer";
import { assembleArtifacts } from "../assembly/issue-assembler";
import { writeJsonFile, writeTextFile } from "../utils/fs";
import { truncate } from "../utils/text";
import type { MetricsRegistry } from "../observability/metrics";
import type { ProcessRequestInput, ProcessResult, ProviderSet } from "../providers/interfaces";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

function selectSummary(evidence: Array<{ type: string; summary: string }>, complaintText: string): string {
  const priorityWeights: Record<string, number> = {
    conflict: 0,
    log: 1,
    network: 2,
    "feature-flag": 3
  };

  const bestEvidence = [...evidence].sort((left, right) => {
    return (priorityWeights[left.type] ?? 99) - (priorityWeights[right.type] ?? 99);
  })[0];

  return bestEvidence?.summary ?? truncate(complaintText, 90) ?? "Support ticket repro pack";
}

export async function processTicket(
  input: ProcessRequestInput,
  providers: ProviderSet,
  logger: MinimalLogger,
  metrics?: MetricsRegistry
): Promise<ProcessResult> {
  const tenantId = providers.tenant?.tenantId ?? input.tenantId ?? "default";
  const startedAt = Date.now();
  let outcome = "success";

  try {
    logger.info({ event: "ingestion.started", lookup: { fixtureId: input.fixtureId, ticketPath: input.ticketPath } });
    const ticket = await ingestTicket(input, providers);
    logger.info({ event: "ingestion.completed", ticketId: ticket.ticketId });

    const context = await enrichContext(ticket, providers);
    for (const providerResult of [context.session, context.logs, context.featureFlags, context.release]) {
      const eventName =
        providerResult.status === "success" ? "provider.fetch.succeeded" : "provider.fetch.failed";
      metrics?.increment("repro_provider_fetch_total", "Context provider fetches", {
        tenant_id: tenantId,
        provider: providerResult.provider,
        status: providerResult.status
      });
      metrics?.observe("repro_provider_fetch_latency_ms", "Context provider fetch latency in milliseconds", providerResult.latencyMs, {
        tenant_id: tenantId,
        provider: providerResult.provider,
        status: providerResult.status
      });
      if (providerResult.status !== "success") {
        metrics?.increment("repro_provider_failures_total", "Context provider failures", {
          tenant_id: tenantId,
          provider: providerResult.provider,
          status: providerResult.status
        });
      }
      logger.info({
        event: eventName,
        provider: providerResult.provider,
        status: providerResult.status,
        errorSummary: providerResult.errorSummary
      });
    }

    const normalized = normalizeEvidence(context);
    const sanitizedPayload = sanitizePayload(normalized.samplePayloadCandidate, {
      ...providers.config,
      redactDirectIdentifiers:
        providers.tenant?.redactDirectIdentifiers ?? providers.config.redactDirectIdentifiers
    });
    logger.info({
      event: "sanitizer.completed",
      ticketId: ticket.ticketId,
      actionCount: sanitizedPayload.report.length
    });
    metrics?.increment("repro_sanitizer_runs_total", "Sanitizer runs", { tenant_id: tenantId });
    metrics?.observe(
      "repro_sanitizer_actions",
      "Sanitizer actions per processed ticket",
      sanitizedPayload.report.length,
      { tenant_id: tenantId }
    );

    const reproSteps = generateReproSteps(context, normalized);
    const confidence = ConfidenceScoreSchema.parse(
      scoreConfidence({ context, normalized, reproSteps, sanitizedPayload })
    );
    logger.info({
      event: "confidence.scored",
      ticketId: ticket.ticketId,
      overall: confidence.overall
    });

    const summary = selectSummary(normalized.evidence, ticket.complaintText);
    const reproPack = ReproPackSchema.parse({
      ticketId: ticket.ticketId,
      summary,
      customerImpact: normalized.customerImpact,
      reproSteps,
      expectedBehavior: normalized.expectedBehavior,
      actualBehavior: normalized.actualBehavior,
      environment: normalized.environment,
      featureFlags: normalized.featureFlags,
      timeline: normalized.timeline,
      logs: normalized.logs,
      samplePayload: sanitizedPayload.payload,
      sanitizationReport: sanitizedPayload.report,
      evidence: normalized.evidence,
      confidence
    });

    const assembled = assembleArtifacts({
      ticket,
      reproPack,
      confidence,
      sanitizedPayload,
      openQuestions: normalized.openQuestions
    });
    logger.info({
      event: "artifact.generated",
      ticketId: ticket.ticketId,
      evidenceCount: reproPack.evidence.length
    });
    metrics?.increment("repro_artifacts_total", "Repro pack artifacts generated", { tenant_id: tenantId });

    const artifactPaths: ProcessResult["artifactPaths"] = {};
    const shouldWriteArtifacts = Boolean(input.writeArtifacts) && !input.dryRun;

    if (shouldWriteArtifacts) {
      const baseDir = path.join(providers.config.artifactOutputDir, ticket.ticketId);
      artifactPaths.json = path.join(baseDir, "repro-pack.json");
      artifactPaths.markdown = path.join(baseDir, "issue.md");
      await writeJsonFile(artifactPaths.json, assembled.reproPack);
      await writeTextFile(artifactPaths.markdown, `${assembled.markdown}\n`);
    }

    return {
      ticket,
      context,
      reproPack: assembled.reproPack,
      issueDraft: assembled.issueDraft,
      markdown: assembled.markdown,
      artifactPaths,
      dryRun: Boolean(input.dryRun)
    };
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    metrics?.observe("repro_processing_duration_ms", "Ticket processing duration in milliseconds", Date.now() - startedAt, {
      tenant_id: tenantId,
      outcome
    });
  }
}
