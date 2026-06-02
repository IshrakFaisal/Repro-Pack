import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/env";
import { AuditEventSchema, type AuditEvent, type IssueLink, type IssueTarget } from "../types/integrations";
import {
  ProcessingJobSchema,
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
import { ensureDirectory, fileExists, readJsonFile, writeJsonFile, writeTextFile } from "../utils/fs";

function nowIso(): string {
  return new Date().toISOString();
}

function isExpired(fileTimestamp: string, retentionDays: number): boolean {
  const ageMs = Date.now() - new Date(fileTimestamp).getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

export class ReproStore {
  private readonly jobsDir: string;
  private readonly packsDir: string;
  private readonly issuesDir: string;
  private readonly auditDir: string;

  constructor(private readonly config: AppConfig) {
    this.jobsDir = path.join(config.dataRoot, "jobs");
    this.packsDir = path.join(config.dataRoot, "packs");
    this.issuesDir = path.join(config.dataRoot, "issues");
    this.auditDir = path.join(config.dataRoot, "audit");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.config.dataRoot),
      ensureDirectory(this.jobsDir),
      ensureDirectory(this.packsDir),
      ensureDirectory(this.issuesDir),
      ensureDirectory(this.auditDir)
    ]);
    await this.recoverInFlightJobs();
    await this.pruneExpiredData();
  }

  private async pruneExpiredData(): Promise<void> {
    const retentionDays = this.config.retentionDays;
    const cleanupDir = async (dirPath: string) => {
      if (!(await fileExists(dirPath))) {
        return;
      }

      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await cleanupDir(fullPath);
            return;
          }

          const stats = await fs.stat(fullPath);
          if (isExpired(stats.mtime.toISOString(), retentionDays)) {
            await fs.unlink(fullPath);
          }
        })
      );
    };

    await Promise.all([cleanupDir(this.jobsDir), cleanupDir(this.packsDir), cleanupDir(this.issuesDir), cleanupDir(this.auditDir)]);
  }

  private async recoverInFlightJobs(): Promise<void> {
    const jobs = await this.listJobs();

    await Promise.all(
      jobs
        .filter((job) => job.status === "queued" || job.status === "running")
        .map((job) =>
          this.saveJob({
            ...job,
            status: "failed",
            updatedAt: nowIso(),
            error: "Server restarted before the job completed"
          })
        )
    );
  }

  private tenantJobDir(tenantId: string): string {
    return path.join(this.jobsDir, tenantId);
  }

  private tenantPackDir(tenantId: string): string {
    return path.join(this.packsDir, tenantId);
  }

  private tenantIssueDir(tenantId: string): string {
    return path.join(this.issuesDir, tenantId);
  }

  private auditPath(tenantId: string, eventId: string): string {
    return path.join(this.auditDir, tenantId, `${eventId}.json`);
  }

  private jobPath(tenantId: string, jobId: string): string {
    return path.join(this.tenantJobDir(tenantId), `${jobId}.json`);
  }

  private packPath(tenantId: string, ticketId: string): string {
    return path.join(this.tenantPackDir(tenantId), `${ticketId}.json`);
  }

  private issuePath(tenantId: string, ticketId: string, target: IssueTarget): string {
    return path.join(this.tenantIssueDir(tenantId), `${ticketId}.${target}.md`);
  }

  async recordAuditEvent(event: Omit<AuditEvent, "eventId" | "timestamp">): Promise<void> {
    const payload = AuditEventSchema.parse({
      eventId: randomUUID(),
      timestamp: nowIso(),
      ...event
    });
    await writeJsonFile(this.auditPath(payload.tenantId, payload.eventId), payload);
  }

  async saveJob(job: ProcessingJob): Promise<void> {
    await ensureDirectory(this.tenantJobDir(job.tenantId));
    await writeJsonFile(this.jobPath(job.tenantId, job.jobId), ProcessingJobSchema.parse(job));
  }

  async getJob(jobId: string, tenantId = "default"): Promise<ProcessingJob | undefined> {
    const filePath = this.jobPath(tenantId, jobId);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return ProcessingJobSchema.parse(await readJsonFile<unknown>(filePath));
  }

  async listJobs(tenantId?: string): Promise<ProcessingJob[]> {
    const root = tenantId ? this.tenantJobDir(tenantId) : this.jobsDir;
    if (!(await fileExists(root))) {
      return [];
    }

    const files = await this.collectJsonFiles(root);
    const jobs = await Promise.all(files.map((filePath) => readJsonFile<unknown>(filePath)));

    return jobs
      .map((entry) => ProcessingJobSchema.parse(entry))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async savePack(record: StoredReproPack): Promise<void> {
    await ensureDirectory(this.tenantPackDir(record.tenantId));
    await writeJsonFile(this.packPath(record.tenantId, record.ticketId), StoredReproPackSchema.parse(record));
  }

  async getPack(ticketId: string, tenantId = "default"): Promise<StoredReproPack | undefined> {
    const filePath = this.packPath(tenantId, ticketId);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return StoredReproPackSchema.parse(await readJsonFile<unknown>(filePath));
  }

  async listPacks(tenantId?: string): Promise<StoredReproPack[]> {
    const root = tenantId ? this.tenantPackDir(tenantId) : this.packsDir;
    if (!(await fileExists(root))) {
      return [];
    }

    const files = await this.collectJsonFiles(root);
    const packs = await Promise.all(files.map((filePath) => readJsonFile<unknown>(filePath)));

    return packs
      .map((entry) => StoredReproPackSchema.parse(entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private async collectJsonFiles(root: string): Promise<string[]> {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
          return this.collectJsonFiles(fullPath);
        }
        return entry.name.endsWith(".json") ? [fullPath] : [];
      })
    );
    return nested.flat();
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

    const issuePath = this.issuePath(tenantId, ticketId, target);
    await ensureDirectory(this.tenantIssueDir(tenantId));
    await writeTextFile(issuePath, `${record.issueDraft.body}\n`);
    return issuePath;
  }
}
