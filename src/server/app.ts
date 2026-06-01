import Fastify from "fastify";
import { z } from "zod";
import { processTicket } from "../pipeline/process-ticket";
import { ingestTicket } from "../ingestion/ticket-ingestion";
import { enrichContext } from "../enrichment/context-enrichment";
import { normalizeEvidence } from "../normalization/evidence-normalizer";
import { createRuntime } from "../runtime/app-runtime";

const ProcessRequestSchema = z
  .object({
    fixtureId: z.string().optional(),
    ticketPath: z.string().optional(),
    ticket: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    writeArtifacts: z.boolean().optional(),
    async: z.boolean().optional()
  })
  .refine((value) => Boolean(value.fixtureId || value.ticketPath || value.ticket), {
    message: "fixtureId, ticketPath, or ticket is required"
  });

const ReviewRequestSchema = z.object({
  status: z.enum(["reviewed", "approved", "rejected"]),
  reviewer: z.string().optional(),
  note: z.string().optional()
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
    providers: [
      providers.support.name,
      providers.logs.name,
      providers.featureFlags.name,
      providers.release.name,
      providers.session.name
    ]
  }));

  app.post("/tickets/process", async (request, reply) => {
    const body = ProcessRequestSchema.parse(request.body);

    if (body.async) {
      const job = await jobs.enqueue(body);
      reply.status(202).send(job);
      return;
    }

    const result = await processTicket(body, providers, logger);
    const storedPack = await jobs.persistSynchronousResult({
      ticketId: result.ticket.ticketId,
      dryRun: result.dryRun,
      sourceLookup: {
        fixtureId: body.fixtureId,
        ticketPath: body.ticketPath
      },
      reproPack: result.reproPack,
      issueDraft: result.issueDraft,
      markdown: result.markdown
    });

    reply.send({
      dryRun: result.dryRun,
      artifactPaths: result.artifactPaths,
      reproPack: result.reproPack,
      issueDraft: result.issueDraft,
      markdown: result.markdown,
      reviewStatus: storedPack.status
    });
  });

  app.get("/jobs/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const job = await store.getJob(params.id);

    if (!job) {
      reply.status(404).send({ error: "Job not found" });
      return;
    }

    reply.send(job);
  });

  app.get("/packs", async () => {
    const packs = await store.listPacks();
    return packs.map((pack) => ({
      ticketId: pack.ticketId,
      status: pack.status,
      updatedAt: pack.updatedAt,
      summary: pack.reproPack.summary,
      confidence: pack.reproPack.confidence.overall
    }));
  });

  app.get("/packs/:ticketId", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const pack = await store.getPack(params.ticketId);

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
      ticketId: params.ticketId,
      status: body.status,
      reviewer: body.reviewer,
      note: body.note
    });

    reply.send(updated);
  });

  app.post("/issues/:ticketId/export", async (request, reply) => {
    const params = z.object({ ticketId: z.string() }).parse(request.params);
    const issuePath = await store.exportIssueDraft(params.ticketId);
    reply.send({
      ticketId: params.ticketId,
      issuePath
    });
  });

  app.get("/debug/ticket/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const ticket = await ingestTicket({ fixtureId: params.id }, providers);
    const context = await enrichContext(ticket, providers);
    const normalized = normalizeEvidence(context);

    return {
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
