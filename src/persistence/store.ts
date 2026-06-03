import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import { AuditEventSchema, type AuditEvent, type IssueLink, type IssueTarget } from "../types/integrations";
import {
  ProcessingJobSchema,
  ProcessingJobStatusSchema,
  ReviewDecisionSchema,
  StoredReproPackSchema,
  type IssueDraft,
  type ProcessingJob,
  type ProviderResult,
  type ReproPack,
  type ReviewDecision,
  type ReviewStatus,
  type StoredReproPack
} from "../types/schemas";
import { writeTextFile } from "../utils/fs";
import type { PersistenceBackend } from "./backend";

function nowIso(): string {
  return new Date().toISOString();
}

export class ReproStore {
  constructor(
    private readonly config: AppConfig,
    private readonly backend: PersistenceBackend
  ) {}

  async initialize(): Promise<void> {
    await this.backend.initialize();
    await this.recoverLeasedJobs();
    await this.backend.pruneExpiredData(this.config.retentionDays);
  }

  async recordAuditEvent(event: Omit<AuditEvent, "eventId" | "timestamp">): Promise<void> {
    const payload = AuditEventSchema.parse({
      eventId: randomUUID(),
      timestamp: nowIso(),
      ...event
    });
    await this.backend.saveAuditEvent(payload);
  }

  async saveJob(job: ProcessingJob): Promise<void> {
    await this.backend.saveJob(ProcessingJobSchema.parse(job));
  }

  async getJob(jobId: string, tenantId = "default"): Promise<ProcessingJob | undefined> {
    return this.backend.getJob(jobId, tenantId);
  }

  async listJobs(tenantId?: string): Promise<ProcessingJob[]> {
    return this.backend.listJobs(tenantId);
  }

  async retryFailedJob(input: { jobId: string; tenantId: string }): Promise<ProcessingJob> {
    const existing = await this.getJob(input.jobId, input.tenantId);
    if (!existing) {
      throw new Error(`Job not found: ${input.jobId}`);
    }

    if (existing.status !== "failed") {
      throw new Error("Only failed jobs can be retried");
    }

    const retried = ProcessingJobSchema.parse({
      ...existing,
      status: ProcessingJobStatusSchema.enum.queued,
      updatedAt: nowIso(),
      leaseExpiresAt: undefined,
      error: undefined
    });
    await this.saveJob(retried);
    return retried;
  }

  async claimNextJob(): Promise<ProcessingJob | undefined> {
    const jobs = await this.listJobs();
    const now = Date.now();
    const candidate = jobs
      .filter((job) => job.status === "queued" || (job.status === "running" && this.isLeaseExpired(job, now)))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!candidate) {
      return undefined;
    }

    const claimed: ProcessingJob = {
      ...candidate,
      status: "running",
      updatedAt: nowIso(),
      leaseExpiresAt: new Date(now + this.config.queueLeaseMs).toISOString(),
      attempts: (candidate.attempts ?? 0) + 1
    };
    await this.saveJob(claimed);
    return claimed;
  }

  async heartbeatJob(jobId: string, tenantId: string): Promise<void> {
    const existing = await this.getJob(jobId, tenantId);
    if (!existing || existing.status !== "running") {
      return;
    }

    await this.saveJob({
      ...existing,
      updatedAt: nowIso(),
      leaseExpiresAt: new Date(Date.now() + this.config.queueLeaseMs).toISOString()
    });
  }

  async savePack(record: StoredReproPack): Promise<void> {
    await this.backend.savePack(StoredReproPackSchema.parse(record));
  }

  async getPack(ticketId: string, tenantId = "default"): Promise<StoredReproPack | undefined> {
    return this.backend.getPack(ticketId, tenantId);
  }

  async listPacks(tenantId?: string): Promise<StoredReproPack[]> {
    return this.backend.listPacks(tenantId);
  }

  async upsertPack(input: {
    tenantId: string;
    ticketId: string;
    dryRun: boolean;
    sourceLookup: { fixtureId?: string; ticketPath?: string; supportTicketId?: string };
    reproPack: ReproPack;
    issueDraft: IssueDraft;
    markdown: string;
    providerResults: {
      session?: ProviderResult;
      logs?: ProviderResult;
      featureFlags?: ProviderResult;
      release?: ProviderResult;
    };
  }): Promise<StoredReproPack> {
    const existing = await this.getPack(input.ticketId, input.tenantId);
    const timestamp = nowIso();
    const record: StoredReproPack = {
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      status: existing?.status ?? "draft",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      dryRun: input.dryRun,
      sourceLookup: input.sourceLookup,
      reproPack: input.reproPack,
      issueDraft: input.issueDraft,
      markdown: input.markdown,
      providerResults: input.providerResults,
      issueLinks: existing?.issueLinks ?? [],
      reviewHistory: existing?.reviewHistory ?? []
    };

    await this.savePack(record);
    return record;
  }

  async reviewPack(input: {
    tenantId: string;
    ticketId: string;
    status: ReviewStatus;
    reviewer?: string;
    note?: string;
    actor?: AuditEvent["actor"];
  }): Promise<StoredReproPack> {
    const existing = await this.getPack(input.ticketId, input.tenantId);
    if (!existing) {
      throw new Error(`Repro pack not found for ticket ${input.ticketId}`);
    }

    const reviewDecision: ReviewDecision = ReviewDecisionSchema.parse({
      status: input.status,
      reviewer: input.reviewer ?? "not available",
      note: input.note ?? "not available",
      createdAt: nowIso()
    });

    const updated: StoredReproPack = {
      ...existing,
      status: input.status,
      updatedAt: nowIso(),
      reviewHistory: [...existing.reviewHistory, reviewDecision]
    };

    await this.savePack(updated);
    await this.recordAuditEvent({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      action: "pack.reviewed",
      outcome: "success",
      actor: input.actor,
      metadata: { status: input.status, reviewer: input.reviewer ?? "not available" }
    });
    return updated;
  }

  async saveIssueLink(input: { tenantId: string; ticketId: string; link: IssueLink }): Promise<StoredReproPack> {
    const existing = await this.getPack(input.ticketId, input.tenantId);
    if (!existing) {
      throw new Error(`Repro pack not found for ticket ${input.ticketId}`);
    }

    const filtered = existing.issueLinks.filter((link) => link.target !== input.link.target);
    const updated: StoredReproPack = {
      ...existing,
      updatedAt: nowIso(),
      issueLinks: [...filtered, input.link]
    };

    await this.savePack(updated);
    return updated;
  }

  async exportIssueDraft(ticketId: string, tenantId = "default", target: IssueTarget = "github"): Promise<string> {
    const record = await this.getPack(ticketId, tenantId);
    if (!record) {
      throw new Error(`Repro pack not found for ticket ${ticketId}`);
    }

    if (record.status !== "approved") {
      throw new Error("Issue draft export requires an approved repro pack");
    }

    const filePath = path.join(this.config.artifactOutputDir, "issues", tenantId, `${ticketId}.${target}.md`);
    await writeTextFile(filePath, `${record.issueDraft.body}\n`);
    return filePath;
  }

  private async recoverLeasedJobs(): Promise<void> {
    const jobs = await this.listJobs();
    const now = Date.now();
    await Promise.all(
      jobs
        .filter((job) => job.status === "running" && this.isLeaseExpired(job, now))
        .map((job) =>
          this.saveJob({
            ...job,
            status: "queued",
            updatedAt: nowIso(),
            leaseExpiresAt: undefined
          })
        )
    );
  }

  private isLeaseExpired(job: ProcessingJob, now = Date.now()): boolean {
    if (!job.leaseExpiresAt) {
      return true;
    }
    return new Date(job.leaseExpiresAt).getTime() <= now;
  }
}
