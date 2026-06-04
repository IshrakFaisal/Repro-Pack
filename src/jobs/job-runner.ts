import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import type { MetricsRegistry } from "../observability/metrics";
import type { ProcessRequestInput, ProviderRegistry } from "../providers/interfaces";
import type { ProcessingJob, StoredReproPack } from "../types/schemas";
import { ReproStore } from "../persistence/store";
import { processTicket } from "../pipeline/process-ticket";
import { WebhookDispatcher } from "../webhooks/dispatcher";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

export class JobRunner {
  private isRunning = false;
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly providers: ProviderRegistry,
    private readonly store: ReproStore,
    private readonly logger: MinimalLogger,
    private readonly metrics: MetricsRegistry,
    private readonly config: AppConfig
  ) {}

  async start(): Promise<void> {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.drain();
    }, this.config.queuePollMs);

    await this.drain();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  async enqueue(input: ProcessRequestInput & { actor?: ProcessingJob["actor"] }): Promise<ProcessingJob> {
    const tenantId = input.tenantId ?? "default";
    const timestamp = new Date().toISOString();
    const job: ProcessingJob = {
      jobId: randomUUID(),
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      tenantId,
      dryRun: Boolean(input.dryRun),
      writeArtifacts: Boolean(input.writeArtifacts),
      customerConsentConfirmed: Boolean(input.customerConsentConfirmed),
      attempts: 0,
      maxAttempts: input.maxAttempts ?? this.config.queueMaxAttempts,
      sourceLookup: {
        fixtureId: input.fixtureId,
        ticketPath: input.ticketPath,
        supportTicketId: input.supportTicketId
      },
      actor: input.actor
    };

    await this.store.saveJob(job);
    this.metrics.increment("repro_queue_jobs_total", "Queue jobs created", { status: "queued", tenant_id: tenantId });
    void this.drain();
    return job;
  }

  async retryFailed(jobId: string, tenantId: string, actor?: ProcessingJob["actor"]): Promise<ProcessingJob> {
    const job = await this.store.retryFailedJob({ jobId, tenantId });
    await this.store.recordAuditEvent({
      tenantId,
      ticketId: job.ticketId,
      action: "job.retried",
      outcome: "success",
      actor,
      metadata: { jobId, attempts: job.attempts }
    });
    this.metrics.increment("repro_queue_job_retries_total", "Failed queue jobs retried", {
      tenant_id: tenantId
    });
    void this.drain();
    return job;
  }

  private async drain(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      while (true) {
        const next = await this.store.claimNextJob();
        if (!next) {
          break;
        }

        await this.runJob(next);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async runJob(job: ProcessingJob): Promise<void> {
    const startedAt = Date.now();
    this.logger.info({ event: "job.started", jobId: job.jobId, tenantId: job.tenantId }, "Started queued job");
    this.metrics.increment("repro_queue_jobs_total", "Queue jobs processed", {
      status: "running",
      tenant_id: job.tenantId
    });

    try {
      const providerSet = await this.providers.create({ tenantId: job.tenantId });
      const input: ProcessRequestInput = {
        tenantId: job.tenantId,
        dryRun: job.dryRun,
        writeArtifacts: job.writeArtifacts,
        customerConsentConfirmed: job.customerConsentConfirmed,
        fixtureId: job.sourceLookup.fixtureId,
        ticketPath: job.sourceLookup.ticketPath,
        supportTicketId: job.sourceLookup.supportTicketId
      };
      const result = await processTicket(input, providerSet, this.logger, this.metrics);
      const storedPack = await this.store.upsertPack({
        tenantId: job.tenantId,
        ticketId: result.ticket.ticketId,
        dryRun: result.dryRun,
        sourceLookup: job.sourceLookup,
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

      await this.store.saveJob({
        ...job,
        status: "succeeded",
        updatedAt: new Date().toISOString(),
        ticketId: result.ticket.ticketId,
        leaseExpiresAt: undefined
      });
      await this.store.recordAuditEvent({
        tenantId: job.tenantId,
        ticketId: result.ticket.ticketId,
        action: "job.completed",
        outcome: "success",
        actor: job.actor,
        metadata: { jobId: job.jobId, attempts: job.attempts }
      });
      void new WebhookDispatcher(this.config, this.logger).dispatch(providerSet.tenant, {
        event: "pack.processed",
        tenantId: storedPack.tenantId,
        ticketId: storedPack.ticketId,
        status: "processed",
        confidence: storedPack.reproPack.confidence.overall,
        timestamp: new Date().toISOString()
      });
      this.metrics.increment("repro_queue_jobs_total", "Queue jobs processed", {
        status: "succeeded",
        tenant_id: job.tenantId
      });
      this.metrics.observe("repro_queue_job_duration_ms", "Queue job processing duration in milliseconds", Date.now() - startedAt, {
        status: "succeeded",
        tenant_id: job.tenantId
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      const isDeadLettered = job.attempts >= job.maxAttempts;
      const terminalStatus = isDeadLettered ? "dead_lettered" : "failed";
      const timestamp = new Date().toISOString();
      await this.store.saveJob({
        ...job,
        status: terminalStatus,
        updatedAt: timestamp,
        leaseExpiresAt: undefined,
        deadLetteredAt: isDeadLettered ? timestamp : undefined,
        error: message
      });
      await this.store.recordAuditEvent({
        tenantId: job.tenantId,
        ticketId: job.ticketId,
        action: isDeadLettered ? "job.dead_lettered" : "job.failed",
        outcome: "error",
        actor: job.actor,
        metadata: { jobId: job.jobId, error: message, attempts: job.attempts, maxAttempts: job.maxAttempts }
      });
      this.logger.error({ event: isDeadLettered ? "job.dead_lettered" : "job.failed", jobId: job.jobId, error: message });
      this.metrics.increment("repro_queue_jobs_total", "Queue jobs processed", {
        status: terminalStatus,
        tenant_id: job.tenantId
      });
      this.metrics.observe("repro_queue_job_duration_ms", "Queue job processing duration in milliseconds", Date.now() - startedAt, {
        status: terminalStatus,
        tenant_id: job.tenantId
      });
    }
  }

  async persistSynchronousResult(result: {
    tenantId: string;
    ticketId: string;
    dryRun: boolean;
    sourceLookup: { fixtureId?: string; ticketPath?: string; supportTicketId?: string };
    reproPack: StoredReproPack["reproPack"];
    issueDraft: StoredReproPack["issueDraft"];
    markdown: string;
    providerResults: StoredReproPack["providerResults"];
  }): Promise<StoredReproPack> {
    return this.store.upsertPack(result);
  }
}
