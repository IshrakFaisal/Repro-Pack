import path from "node:path";
import fs from "node:fs/promises";
import type { AppConfig } from "../config/env";
import {
  ProcessingJobSchema,
  ReviewDecisionSchema,
  StoredReproPackSchema,
  type IssueDraft,
  type ProcessingJob,
  type ReproPack,
  type ReviewDecision,
  type ReviewStatus,
  type StoredReproPack
} from "../types/schemas";
import { ensureDirectory, fileExists, readJsonFile, writeJsonFile, writeTextFile } from "../utils/fs";

function nowIso(): string {
  return new Date().toISOString();
}

export class ReproStore {
  private readonly jobsDir: string;
  private readonly packsDir: string;
  private readonly issuesDir: string;

  constructor(private readonly config: AppConfig) {
    this.jobsDir = path.join(config.dataRoot, "jobs");
    this.packsDir = path.join(config.dataRoot, "packs");
    this.issuesDir = path.join(config.dataRoot, "issues");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.config.dataRoot),
      ensureDirectory(this.jobsDir),
      ensureDirectory(this.packsDir),
      ensureDirectory(this.issuesDir)
    ]);
    await this.recoverInFlightJobs();
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

  private jobPath(jobId: string): string {
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private packPath(ticketId: string): string {
    return path.join(this.packsDir, `${ticketId}.json`);
  }

  private issuePath(ticketId: string): string {
    return path.join(this.issuesDir, `${ticketId}.md`);
  }

  async saveJob(job: ProcessingJob): Promise<void> {
    await writeJsonFile(this.jobPath(job.jobId), ProcessingJobSchema.parse(job));
  }

  async getJob(jobId: string): Promise<ProcessingJob | undefined> {
    const filePath = this.jobPath(jobId);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return ProcessingJobSchema.parse(await readJsonFile<unknown>(filePath));
  }

  async listJobs(): Promise<ProcessingJob[]> {
    if (!(await fileExists(this.jobsDir))) {
      return [];
    }

    const entries = await fs.readdir(this.jobsDir);
    const jobs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<unknown>(path.join(this.jobsDir, entry)))
    );

    return jobs
      .map((entry) => ProcessingJobSchema.parse(entry))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async savePack(record: StoredReproPack): Promise<void> {
    await writeJsonFile(this.packPath(record.ticketId), StoredReproPackSchema.parse(record));
  }

  async getPack(ticketId: string): Promise<StoredReproPack | undefined> {
    const filePath = this.packPath(ticketId);
    if (!(await fileExists(filePath))) {
      return undefined;
    }

    return StoredReproPackSchema.parse(await readJsonFile<unknown>(filePath));
  }

  async listPacks(): Promise<StoredReproPack[]> {
    if (!(await fileExists(this.packsDir))) {
      return [];
    }

    const entries = await fs.readdir(this.packsDir);
    const packs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonFile<unknown>(path.join(this.packsDir, entry)))
    );

    return packs
      .map((entry) => StoredReproPackSchema.parse(entry))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async upsertPack(input: {
    ticketId: string;
    dryRun: boolean;
    sourceLookup: { fixtureId?: string; ticketPath?: string };
    reproPack: ReproPack;
    issueDraft: IssueDraft;
    markdown: string;
  }): Promise<StoredReproPack> {
    const existing = await this.getPack(input.ticketId);
    const timestamp = nowIso();

    const record: StoredReproPack = {
      ticketId: input.ticketId,
      status: existing?.status ?? "draft",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      dryRun: input.dryRun,
      sourceLookup: input.sourceLookup,
      reproPack: input.reproPack,
      issueDraft: input.issueDraft,
      markdown: input.markdown,
      reviewHistory: existing?.reviewHistory ?? []
    };

    await this.savePack(record);
    return record;
  }

  async reviewPack(input: {
    ticketId: string;
    status: ReviewStatus;
    reviewer?: string;
    note?: string;
  }): Promise<StoredReproPack> {
    const existing = await this.getPack(input.ticketId);
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
    return updated;
  }

  async exportIssueDraft(ticketId: string): Promise<string> {
    const record = await this.getPack(ticketId);
    if (!record) {
      throw new Error(`Repro pack not found for ticket ${ticketId}`);
    }

    if (record.status !== "approved") {
      throw new Error("Issue draft export requires an approved repro pack");
    }

    const issuePath = this.issuePath(ticketId);
    await writeTextFile(issuePath, `${record.issueDraft.body}\n`);
    return issuePath;
  }
}
