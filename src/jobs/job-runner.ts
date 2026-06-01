import { randomUUID } from "node:crypto";
import type { ProcessRequestInput, ProviderSet } from "../providers/interfaces";
import type { ProcessingJob, StoredReproPack } from "../types/schemas";
import { ReproStore } from "../persistence/store";
import { processTicket } from "../pipeline/process-ticket";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

type QueueItem = {
  jobId: string;
  input: ProcessRequestInput;
};

export class JobRunner {
  private readonly queue: QueueItem[] = [];
  private isRunning = false;

  constructor(
    private readonly providers: ProviderSet,
    private readonly store: ReproStore,
    private readonly logger: MinimalLogger
  ) {}

  async enqueue(input: ProcessRequestInput): Promise<ProcessingJob> {
    const timestamp = new Date().toISOString();
    const job: ProcessingJob = {
      jobId: randomUUID(),
      status: "queued",
      createdAt: timestamp,
      updatedAt: timestamp,
      dryRun: Boolean(input.dryRun),
      writeArtifacts: Boolean(input.writeArtifacts),
      sourceLookup: {
        fixtureId: input.fixtureId,
        ticketPath: input.ticketPath
      }
    };

    await this.store.saveJob(job);
    this.queue.push({ jobId: job.jobId, input });
    this.schedule();
    return job;
  }

  private schedule(): void {
    if (this.isRunning) {
      return;
    }

    setImmediate(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        continue;
      }

      await this.runJob(next);
    }
    this.isRunning = false;
  }

  private async runJob(item: QueueItem): Promise<void> {
    const existing = await this.store.getJob(item.jobId);
    if (!existing) {
      return;
    }

    const runningJob: ProcessingJob = {
      ...existing,
      status: "running",
      updatedAt: new Date().toISOString()
    };
    await this.store.saveJob(runningJob);
    this.logger.info({ event: "job.started", jobId: item.jobId });

    try {
      const result = await processTicket(item.input, this.providers, this.logger);
      await this.store.upsertPack({
        ticketId: result.ticket.ticketId,
        dryRun: result.dryRun,
        sourceLookup: {
          fixtureId: item.input.fixtureId,
          ticketPath: item.input.ticketPath
        },
        reproPack: result.reproPack,
        issueDraft: result.issueDraft,
        markdown: result.markdown
      });

      await this.store.saveJob({
        ...runningJob,
        status: "succeeded",
        updatedAt: new Date().toISOString(),
        ticketId: result.ticket.ticketId
      });
      this.logger.info({ event: "job.completed", jobId: item.jobId, ticketId: result.ticket.ticketId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      await this.store.saveJob({
        ...runningJob,
        status: "failed",
        updatedAt: new Date().toISOString(),
        error: message
      });
      this.logger.error({ event: "job.failed", jobId: item.jobId, error: message });
    }
  }

  async persistSynchronousResult(result: {
    ticketId: string;
    dryRun: boolean;
    sourceLookup: { fixtureId?: string; ticketPath?: string };
    reproPack: StoredReproPack["reproPack"];
    issueDraft: StoredReproPack["issueDraft"];
    markdown: string;
  }): Promise<StoredReproPack> {
    return this.store.upsertPack(result);
  }
}
