import Fastify from "fastify";
import { z } from "zod";
import { processTicket } from "../pipeline/process-ticket";
import { ingestTicket } from "../ingestion/ticket-ingestion";
import { enrichContext } from "../enrichment/context-enrichment";
import { normalizeEvidence } from "../normalization/evidence-normalizer";
import { createRuntime } from "../runtime/app-runtime";
import { syncIssuesForPack } from "../issues/issue-sync";

const ProcessRequestSchema = z
  .object({
    tenantId: z.string().optional(),
    fixtureId: z.string().optional(),
    ticketPath: z.string().optional(),
    supportTicketId: z.string().optional(),
    ticket: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    writeArtifacts: z.boolean().optional(),
    async: z.boolean().optional()
  })
  .refine((value) => Boolean(value.fixtureId || value.ticketPath || value.supportTicketId || value.ticket), {
    message: "fixtureId, ticketPath, supportTicketId, or ticket is required"
  });

const TenantQuerySchema = z.object({
  tenantId: z.string().optional()
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
  targets: z.array(z.enum(["github", "jira"])).default(["github", "jira"])
});

function createUnauthorizedError() {
  const error = new Error("Unauthorized");
  (error as Error & { statusCode?: number }).statusCode = 401;
  return error;
}

export async function createApp() {
  const runtime = await createRuntime();
  const { config, logger, providers, store, jobs } = runtime;
  const app = Fastify({ loggerInstance: logger });

  app.addHook("onRequest", async (request) => {
    if (request.url === "/health" || !config.apiKey) {
      return;
    }

    const headerValue = request.headers["x-api-key"];
    if (headerValue !== config.apiKey) {
      throw createUnauthorizedError();
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    version: config.appVersion,
    buildHash: config.buildHash,
    dataRoot: config.dataRoot,
    tenantConfigRoot: config.tenantConfigRoot
  }));

  app.post("/tickets/process", async (request, reply) => {
    const body = ProcessRequestSchema.parse(request.body);

    if (body.async) {
      const job = await jobs.enqueue(body);
      reply.status(202).send(job);
      return;
    }

    const providerSet = await providers.create({ tenantId: body.tenantId });
    const result = await processTicket(body, providerSet, logger);
    const tenantId = body.tenantId ?? "default";
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
      metadata: {
        dryRun: result.dryRun,
        issueLinks: storedPack.issueLinks.length
      }
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

  app.get("/jobs/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const tenantId = query.tenantId ?? "default";
    const job = await store.getJob(params.id, tenantId);

    if (!job) {
      reply.status(404).send({ error: "Job not found" });
      return;
    }

    reply.send(job);
  });

  app.get("/packs", async (request) => {
    const query = TenantQuerySchema.parse(request.query);
    const packs = await store.listPacks(query.tenantId);
    return packs.map((pack) => ({
      tenantId: pack.tenantId,
      ticketId: pack.ticketId,
      status: pack.status,
      updatedAt: pack.updatedAt,
      summary: pack.reproPack.summary,
      confidence: pack.reproPack.confidence.overall,
      issueLinks: pack.issueLinks
    }));
  });

  app.get("/packs/:ticketId", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const pack = await store.getPack(params.ticketId, query.tenantId ?? "default");

    if (!pack) {
      reply.status(404).send({ error: "Repro pack not found" });
      return;
    }

    reply.send(pack);
  });

  app.post("/packs/:ticketId/review", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = ReviewRequestSchema.parse(request.body);
    const updated = await store.reviewPack({
      tenantId: body.tenantId ?? "default",
      ticketId: params.ticketId,
      status: body.status,
      reviewer: body.reviewer,
      note: body.note
    });

    reply.send(updated);
  });

  app.post("/packs/:ticketId/sync-issues", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = IssueSyncRequestSchema.parse(request.body);
    const tenantId = body.tenantId ?? "default";
    const providerSet = await providers.create({ tenantId });
    const results = await syncIssuesForPack({
      tenantId,
      ticketId: params.ticketId,
      providers: providerSet,
      store,
      targets: body.targets,
      dryRun: body.dryRun
    });

    reply.send({
      tenantId,
      ticketId: params.ticketId,
      dryRun: body.dryRun,
      results
    });
  });

  app.post("/issues/:ticketId/export", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const body = z.object({ tenantId: z.string().optional(), target: z.enum(["github", "jira"]).optional() }).parse(request.body ?? {});
    const issuePath = await store.exportIssueDraft(params.ticketId, body.tenantId ?? "default", body.target ?? "github");
    reply.send({
      tenantId: body.tenantId ?? "default",
      ticketId: params.ticketId,
      issuePath
    });
  });

  app.get("/debug/ticket/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const query = TenantQuerySchema.parse(request.query);
    const providerSet = await providers.create({ tenantId: query.tenantId });
    const ticket = await ingestTicket(
      query.tenantId ? { tenantId: query.tenantId, supportTicketId: params.id } : { fixtureId: params.id },
      providerSet
    );
    const context = await enrichContext(ticket, providerSet);
    const normalized = normalizeEvidence(context);

    return {
      tenantId: query.tenantId ?? "default",
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

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unknown request error";
    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 400;
    logger.error({ event: "process.failed", error: message, statusCode }, "Request failed");
    reply.status(statusCode).send({ error: message });
  });

  return app;
}
