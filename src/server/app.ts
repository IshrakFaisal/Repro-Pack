import Fastify from "fastify";
import { z } from "zod";
import { ensureRole, authenticateRequest, ensureTenantAccess, type AuthActor } from "../auth/auth";
import { classifyError } from "../observability/errors";
import { processTicket } from "../pipeline/process-ticket";
import { ingestTicket } from "../ingestion/ticket-ingestion";
import { enrichContext } from "../enrichment/context-enrichment";
import { normalizeEvidence } from "../normalization/evidence-normalizer";
import { createRuntime } from "../runtime/app-runtime";
import { syncIssuesForPack } from "../issues/issue-sync";
import { buildAnalyticsSummary } from "../analytics/team-intelligence";
import { buildTriageRecommendations } from "../triage/recommendations";
import type { StoredReproPack } from "../types/schemas";
import { WebhookDispatcher } from "../webhooks/dispatcher";
import type { PackWebhookEvent } from "../webhooks/events";
import type { ProviderSet } from "../providers/interfaces";

const ProcessRequestSchema = z
  .object({
    tenantId: z.string().optional(),
    fixtureId: z.string().optional(),
    ticketPath: z.string().optional(),
    supportTicketId: z.string().optional(),
    ticket: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    writeArtifacts: z.boolean().optional(),
    async: z.boolean().optional(),
    maxAttempts: z.number().int().positive().max(25).optional(),
    customerConsentConfirmed: z.boolean().optional()
  })
  .refine((value) => Boolean(value.fixtureId || value.ticketPath || value.supportTicketId || value.ticket), {
    message: "fixtureId, ticketPath, supportTicketId, or ticket is required"
  });

const BatchProcessRequestSchema = z.object({
  tenantId: z.string().optional(),
  async: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  writeArtifacts: z.boolean().optional(),
  customerConsentConfirmed: z.boolean().optional(),
  items: z
    .array(
      z
        .object({
          fixtureId: z.string().optional(),
          ticketPath: z.string().optional(),
          supportTicketId: z.string().optional(),
          ticket: z.unknown().optional(),
          dryRun: z.boolean().optional(),
          writeArtifacts: z.boolean().optional(),
          customerConsentConfirmed: z.boolean().optional()
        })
        .refine((value) => Boolean(value.fixtureId || value.ticketPath || value.supportTicketId || value.ticket), {
          message: "fixtureId, ticketPath, supportTicketId, or ticket is required"
        })
    )
    .min(1)
    .max(25)
});

const TenantQuerySchema = z.object({
  tenantId: z.string().optional()
});

const JobListQuerySchema = TenantQuerySchema.extend({
  status: z.enum(["queued", "running", "succeeded", "failed", "dead_lettered"]).optional()
});

const JobRetryRequestSchema = z.object({
  tenantId: z.string().optional()
});

const PackListQuerySchema = TenantQuerySchema.extend({
  status: z.enum(["draft", "reviewed", "approved", "rejected"]).optional(),
  search: z.string().optional(),
  sort: z.enum(["updatedAt", "createdAt", "ticketId", "confidence"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).default(0)
});

const AuditListQuerySchema = TenantQuerySchema.extend({
  action: z.string().optional(),
  outcome: z.enum(["success", "error"]).optional(),
  ticketId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0)
});

const TriageQuerySchema = TenantQuerySchema.extend({
  status: z.enum(["draft", "reviewed", "approved", "rejected"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

const ReviewRequestSchema = z.object({
  tenantId: z.string().optional(),
  status: z.enum(["reviewed", "approved", "rejected"]),
  reviewer: z.string().optional(),
  note: z.string().optional()
});

const IssueSyncRequestSchema = z.object({
  tenantId: z.string().optional(),
  dryRun: z.boolean().default(true),
  targets: z.array(z.enum(["github", "jira", "linear"])).default(["github", "jira"])
});

function tenantIdFromRequest(request: { headers: Record<string, unknown>; body?: unknown; query?: unknown }): string | undefined {
  const headerTenant = request.headers["x-tenant-id"];
  if (typeof headerTenant === "string" && headerTenant.trim()) {
    return headerTenant.trim();
  }

  if (request.body && typeof request.body === "object" && request.body !== null && "tenantId" in request.body) {
    const bodyTenant = (request.body as { tenantId?: unknown }).tenantId;
    if (typeof bodyTenant === "string" && bodyTenant.trim()) {
      return bodyTenant.trim();
    }
  }

  if (request.query && typeof request.query === "object" && request.query !== null && "tenantId" in request.query) {
    const queryTenant = (request.query as { tenantId?: unknown }).tenantId;
    if (typeof queryTenant === "string" && queryTenant.trim()) {
      return queryTenant.trim();
    }
  }

  return undefined;
}

function resolveTenantScope(
  actor: AuthActor,
  requestedTenantId: string | undefined
): string {
  const tenantId = requestedTenantId ?? actor.tenantId;
  ensureTenantAccess(actor, tenantId);
  return tenantId;
}

function resolveListTenantScope(actor: AuthActor, requestedTenantId: string | undefined): string | undefined {
  if (!requestedTenantId && actor.authMethod === "global-api-key") {
    return undefined;
  }

  return resolveTenantScope(actor, requestedTenantId);
}

function matchesPackSearch(pack: StoredReproPack, search?: string): boolean {
  if (!search?.trim()) {
    return true;
  }

  const needle = search.trim().toLowerCase();
  return pack.ticketId.toLowerCase().includes(needle) || pack.reproPack.summary.toLowerCase().includes(needle);
}

function sortPacks(
  packs: StoredReproPack[],
  sort: z.infer<typeof PackListQuerySchema>["sort"],
  direction: z.infer<typeof PackListQuerySchema>["direction"]
): StoredReproPack[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...packs].sort((left, right) => {
    if (sort === "confidence") {
      return (left.reproPack.confidence.overall - right.reproPack.confidence.overall) * multiplier;
    }

    const leftValue = sort === "ticketId" ? left.ticketId : sort === "createdAt" ? left.createdAt : left.updatedAt;
    const rightValue = sort === "ticketId" ? right.ticketId : sort === "createdAt" ? right.createdAt : right.updatedAt;
    return leftValue.localeCompare(rightValue) * multiplier;
  });
}

function providerStatusSummary(pack: StoredReproPack) {
  return {
    session: pack.providerResults.session?.status ?? "unavailable",
    logs: pack.providerResults.logs?.status ?? "unavailable",
    featureFlags: pack.providerResults.featureFlags?.status ?? "unavailable",
    release: pack.providerResults.release?.status ?? "unavailable"
  };
}

function buildPackUrl(baseUrl: string | undefined, tenantId: string, ticketId: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return `${baseUrl}/packs/${encodeURIComponent(ticketId)}?tenantId=${encodeURIComponent(tenantId)}`;
}

function dispatchPackWebhook(input: {
  dispatcher: WebhookDispatcher;
  providerSet: ProviderSet;
  pack: StoredReproPack;
  event: PackWebhookEvent["event"];
  status: PackWebhookEvent["status"];
}) {
  void input.dispatcher.dispatch(input.providerSet.tenant, {
    event: input.event,
    tenantId: input.pack.tenantId,
    ticketId: input.pack.ticketId,
    status: input.status,
    confidence: input.pack.reproPack.confidence.overall,
    timestamp: new Date().toISOString()
  });
}

export async function createApp() {
  const runtime = await createRuntime();
  const { config, logger, metrics, providers, store, jobs } = runtime;
  const app = Fastify({ loggerInstance: logger });
  const webhookDispatcher = new WebhookDispatcher(config, logger);

  async function resolveActor(request: Parameters<typeof authenticateRequest>[0]["request"]): Promise<AuthActor | undefined> {
    const tenantId = tenantIdFromRequest({ headers: request.headers as Record<string, unknown>, body: request.body, query: request.query });
    const providerSet = await providers.create({ tenantId });
    return authenticateRequest({ request, config, tenant: providerSet.tenant });
  }

  app.addHook("preHandler", async (request) => {
    const publicPaths = new Set(["/health", "/health/live", "/health/ready", "/metrics"]);
    const requestPath = request.url.split("?")[0] ?? request.url;
    if (publicPaths.has(requestPath)) {
      return;
    }

    const actor = await resolveActor(request);
    if (!actor) {
      const tenantId = tenantIdFromRequest({ headers: request.headers as Record<string, unknown>, body: request.body, query: request.query }) ?? "default";
      await store.recordAuditEvent({
        tenantId,
        action: "auth.failed",
        outcome: "error",
        metadata: {
          route: request.url,
          method: request.method
        }
      });
      const error = new Error("Unauthorized");
      (error as Error & { statusCode?: number }).statusCode = 401;
      throw error;
    }

    (request as FastifyRequestWithActor).authActor = actor;
  });

  app.get("/health", async () => ({
    status: "ok",
    version: config.appVersion,
    buildHash: config.buildHash,
    dataRoot: config.dataRoot,
    tenantConfigRoot: config.tenantConfigRoot,
    storageDriver: config.storageDriver
  }));

  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async () => ({ status: "ready", storageDriver: config.storageDriver }));
  app.get("/metrics", async (_request, reply) => {
    reply.type("text/plain; version=0.0.4");
    return metrics.renderPrometheus();
  });

  app.post("/tickets/process", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "process");
    const body = ProcessRequestSchema.parse(request.body);
    const tenantId = resolveTenantScope(actor, body.tenantId);

    if (body.async) {
      const job = await jobs.enqueue({ ...body, tenantId, actor });
      await store.recordAuditEvent({
        tenantId,
        action: "ticket.processing.enqueued",
        outcome: "success",
        actor,
        metadata: { jobId: job.jobId }
      });
      reply.status(202).send(job);
      return;
    }

    const providerSet = await providers.create({ tenantId });
    const result = await processTicket({ ...body, tenantId }, providerSet, logger, metrics);
    const storedPack = await jobs.persistSynchronousResult({
      tenantId,
      ticketId: result.ticket.ticketId,
      dryRun: result.dryRun,
      sourceLookup: {
        fixtureId: body.fixtureId,
        ticketPath: body.ticketPath,
        supportTicketId: body.supportTicketId
      },
      reproPack: result.reproPack,
      issueDraft: result.issueDraft,
      markdown: result.markdown,
      providerResults: {
        session: result.context.session,
        logs: result.context.logs,
        featureFlags: result.context.featureFlags,
        release: result.context.release
      }
    });

    await store.recordAuditEvent({
      tenantId,
      ticketId: result.ticket.ticketId,
      action: "ticket.processed",
      outcome: "success",
      actor,
      metadata: {
        dryRun: result.dryRun,
        issueLinks: storedPack.issueLinks.length
      }
    });
    dispatchPackWebhook({
      dispatcher: webhookDispatcher,
      providerSet,
      pack: storedPack,
      event: "pack.processed",
      status: "processed"
    });
    void providerSet.notifications.slack?.postReviewRequest?.({
      tenantId,
      tenantName: providerSet.tenant?.name ?? tenantId,
      ticketId: storedPack.ticketId,
      summary: storedPack.reproPack.summary,
      confidence: storedPack.reproPack.confidence.overall,
      packUrl: buildPackUrl(config.baseUrl, tenantId, storedPack.ticketId)
    });

    reply.send({
      tenantId,
      dryRun: result.dryRun,
      artifactPaths: result.artifactPaths,
      reproPack: result.reproPack,
      issueDraft: result.issueDraft,
      markdown: result.markdown,
      reviewStatus: storedPack.status,
      issueLinks: storedPack.issueLinks
    });
  });

  app.post("/tickets/batch-process", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "process");
    const body = BatchProcessRequestSchema.parse(request.body);
    const tenantId = resolveTenantScope(actor, body.tenantId);

    if (body.async) {
      const enqueued = [];
      for (const item of body.items) {
        const job = await jobs.enqueue({
          ...item,
          tenantId,
          dryRun: item.dryRun ?? body.dryRun,
          writeArtifacts: item.writeArtifacts ?? body.writeArtifacts,
          customerConsentConfirmed: item.customerConsentConfirmed ?? body.customerConsentConfirmed,
          actor
        });
        enqueued.push({
          status: "enqueued",
          jobId: job.jobId,
          sourceLookup: job.sourceLookup
        });
      }

      await store.recordAuditEvent({
        tenantId,
        action: "ticket.batch_processing.enqueued",
        outcome: "success",
        actor,
        metadata: { count: enqueued.length }
      });
      reply.status(202).send({ tenantId, async: true, results: enqueued });
      return;
    }

    const providerSet = await providers.create({ tenantId });
    const results = [];
    for (const item of body.items) {
      try {
        const result = await processTicket(
          {
            ...item,
            tenantId,
            dryRun: item.dryRun ?? body.dryRun,
            writeArtifacts: item.writeArtifacts ?? body.writeArtifacts,
            customerConsentConfirmed: item.customerConsentConfirmed ?? body.customerConsentConfirmed
          },
          providerSet,
          logger,
          metrics
        );
        const storedPack = await jobs.persistSynchronousResult({
          tenantId,
          ticketId: result.ticket.ticketId,
          dryRun: result.dryRun,
          sourceLookup: {
            fixtureId: item.fixtureId,
            ticketPath: item.ticketPath,
            supportTicketId: item.supportTicketId
          },
          reproPack: result.reproPack,
          issueDraft: result.issueDraft,
          markdown: result.markdown,
          providerResults: {
            session: result.context.session,
            logs: result.context.logs,
            featureFlags: result.context.featureFlags,
            release: result.context.release
          }
        });
        results.push({
          status: "processed",
          ticketId: result.ticket.ticketId,
          reviewStatus: storedPack.status,
          confidence: result.reproPack.confidence.overall,
          customerImpactScore: result.reproPack.customerImpactScore.score
        });
      } catch (error) {
        const classified = classifyError(error);
        results.push({
          status: "error",
          error: classified.message,
          code: classified.code
        });
      }
    }

    await store.recordAuditEvent({
      tenantId,
      action: "ticket.batch_processed",
      outcome: results.some((result) => result.status === "error") ? "error" : "success",
      actor,
      metadata: { count: results.length, errorCount: results.filter((result) => result.status === "error").length }
    });
    reply.send({ tenantId, async: false, results });
  });

  app.get("/jobs", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const query = JobListQuerySchema.parse(request.query);
    const tenantId = resolveListTenantScope(actor, query.tenantId);
    const jobsForTenant = await store.listJobs(tenantId);
    return jobsForTenant.filter((job) => !query.status || job.status === query.status);
  });

  app.get("/audit-events", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const query = AuditListQuerySchema.parse(request.query);
    const tenantId = resolveListTenantScope(actor, query.tenantId);
    const events = await store.listAuditEvents({
      tenantId,
      action: query.action,
      outcome: query.outcome,
      ticketId: query.ticketId
    });
    return events.slice(query.offset, query.limit ? query.offset + query.limit : undefined);
  });

  app.get("/analytics/summary", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const query = TenantQuerySchema.parse(request.query);
    const tenantId = resolveListTenantScope(actor, query.tenantId);
    const [packs, auditEvents] = await Promise.all([
      store.listPacks(tenantId),
      store.listAuditEvents({ tenantId })
    ]);

    return buildAnalyticsSummary({ tenantId, packs, auditEvents });
  });

  app.get("/triage/recommendations", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const query = TriageQuerySchema.parse(request.query);
    const tenantId = resolveListTenantScope(actor, query.tenantId);
    const packs = await store.listPacks(tenantId);
    return buildTriageRecommendations({ packs, status: query.status, limit: query.limit });
  });

  app.get("/jobs/:id", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const tenantId = resolveTenantScope(actor, query.tenantId);
    const job = await store.getJob(params.id, tenantId);

    if (!job) {
      reply.status(404).send({ error: "Job not found" });
      return;
    }

    reply.send(job);
  });

  app.post("/jobs/:id/retry", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "process");
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = JobRetryRequestSchema.parse(request.body ?? {});
    const tenantId = resolveTenantScope(actor, body.tenantId);
    const job = await jobs.retryFailed(params.id, tenantId, actor);
    reply.status(202).send(job);
  });

  app.get("/packs", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const query = PackListQuerySchema.parse(request.query);
    const tenantId = resolveListTenantScope(actor, query.tenantId);
    const packs = await store.listPacks(tenantId);
    return sortPacks(
      packs
      .filter((pack) => !query.status || pack.status === query.status)
      .filter((pack) => matchesPackSearch(pack, query.search)),
      query.sort,
      query.direction
    )
      .slice(query.offset, query.limit ? query.offset + query.limit : undefined)
      .map((pack) => ({
        tenantId: pack.tenantId,
        ticketId: pack.ticketId,
        status: pack.status,
        updatedAt: pack.updatedAt,
        summary: pack.reproPack.summary,
        confidence: pack.reproPack.confidence.overall,
        providerStatus: providerStatusSummary(pack),
        issueLinks: pack.issueLinks,
        reviewHistoryCount: pack.reviewHistory.length,
        lastReview: pack.reviewHistory.at(-1)
      }));
  });

  app.get("/packs/:ticketId", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const tenantId = resolveTenantScope(actor, query.tenantId);
    const pack = await store.getPack(params.ticketId, tenantId);

    if (!pack) {
      reply.status(404).send({ error: "Repro pack not found" });
      return;
    }

    reply.send(pack);
  });

  app.post("/packs/:ticketId/review", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "review");
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = ReviewRequestSchema.parse(request.body);
    const tenantId = resolveTenantScope(actor, body.tenantId);
    const providerSet = await providers.create({ tenantId });
    const updated = await store.reviewPack({
      tenantId,
      ticketId: params.ticketId,
      status: body.status,
      reviewer: body.reviewer ?? actor.actorId,
      note: body.note,
      actor
    });

    if (body.status === "approved") {
      void providerSet.notifications.slack?.postPackApproved({
        tenantId,
        tenantName: providerSet.tenant?.name ?? tenantId,
        ticketId: updated.ticketId,
        confidence: updated.reproPack.confidence.overall,
        reviewer: body.reviewer ?? actor.actorId,
        packUrl: buildPackUrl(config.baseUrl, tenantId, updated.ticketId)
      });
      dispatchPackWebhook({
        dispatcher: webhookDispatcher,
        providerSet,
        pack: updated,
        event: "pack.approved",
        status: "approved"
      });
    }

    reply.send(updated);
  });

  app.post("/packs/:ticketId/sync-issues", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "sync");
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = IssueSyncRequestSchema.parse(request.body);
    const tenantId = resolveTenantScope(actor, body.tenantId);
    const providerSet = await providers.create({ tenantId });
    const results = await syncIssuesForPack({
      tenantId,
      ticketId: params.ticketId,
      providers: providerSet,
      store,
      targets: body.targets,
      dryRun: body.dryRun,
      actor,
      metrics
    });
    const syncedPack = await store.getPack(params.ticketId, tenantId);
    if (!body.dryRun && syncedPack) {
      dispatchPackWebhook({
        dispatcher: webhookDispatcher,
        providerSet,
        pack: syncedPack,
        event: "pack.synced",
        status: "synced"
      });
    }

    reply.send({
      tenantId,
      ticketId: params.ticketId,
      dryRun: body.dryRun,
      results
    });
  });

  app.post("/issues/:ticketId/export", async (request, reply) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = z.object({ tenantId: z.string().optional(), target: z.enum(["github", "jira", "linear"]).optional() }).parse(request.body ?? {});
    const tenantId = resolveTenantScope(actor, body.tenantId);
    const issuePath = await store.exportIssueDraft(params.ticketId, tenantId, body.target ?? "github");
    reply.send({
      tenantId,
      ticketId: params.ticketId,
      issuePath
    });
  });

  app.get("/debug/ticket/:id", async (request) => {
    const actor = ensureRole((request as FastifyRequestWithActor).authActor, "read");
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const tenantId = query.tenantId
      ? resolveTenantScope(actor, query.tenantId)
      : actor.authMethod === "global-api-key"
        ? undefined
        : resolveTenantScope(actor, undefined);
    const providerSet = await providers.create({ tenantId });
    const ticket = await ingestTicket(
      tenantId ? { tenantId, supportTicketId: params.id } : { fixtureId: params.id },
      providerSet
    );
    const context = await enrichContext(ticket, providerSet);
    const normalized = normalizeEvidence(context);

    return {
      tenantId: tenantId ?? "default",
      ticket,
      providerStatus: {
        session: {
          provider: context.session.provider,
          status: context.session.status,
          fetchedAt: context.session.fetchedAt,
          latencyMs: context.session.latencyMs,
          errorSummary: context.session.errorSummary
        },
        logs: {
          provider: context.logs.provider,
          status: context.logs.status,
          fetchedAt: context.logs.fetchedAt,
          latencyMs: context.logs.latencyMs,
          errorSummary: context.logs.errorSummary
        },
        featureFlags: {
          provider: context.featureFlags.provider,
          status: context.featureFlags.status,
          fetchedAt: context.featureFlags.fetchedAt,
          latencyMs: context.featureFlags.latencyMs,
          errorSummary: context.featureFlags.errorSummary
        },
        release: {
          provider: context.release.provider,
          status: context.release.status,
          fetchedAt: context.release.fetchedAt,
          latencyMs: context.release.latencyMs,
          errorSummary: context.release.errorSummary
        }
      },
      evidencePreview: normalized.evidence,
      environment: normalized.environment,
      openQuestions: normalized.openQuestions
    };
  });

  app.setErrorHandler(async (error, request, reply) => {
    const classified = classifyError(error);
    logger.error({ event: "process.failed", error: classified.message, code: classified.code, statusCode: classified.statusCode }, "Request failed");
    const tenantId = tenantIdFromRequest({ headers: request.headers as Record<string, unknown>, body: request.body, query: request.query }) ?? "default";
    await store.recordAuditEvent({
      tenantId,
      action: classified.code === "request_error" ? "request.failed" : "request.error",
      outcome: "error",
      actor: (request as FastifyRequestWithActor).authActor,
      metadata: {
        route: request.url,
        method: request.method,
        errorCode: classified.code,
        statusCode: classified.statusCode
      }
    });
    reply.status(classified.statusCode).send({ error: classified.message, code: classified.code });
  });

  app.addHook("onClose", async () => {
    await jobs.stop();
  });

  return app;
}

type FastifyRequestWithActor = {
  authActor?: AuthActor;
};
