import path from "node:path";
import fs from "node:fs/promises";
import type { AuditEvent } from "../types/integrations";
import { AuditEventSchema } from "../types/integrations";
import { ProcessingJobSchema, StoredReproPackSchema, type ProcessingJob, type StoredReproPack } from "../types/schemas";
import { ensureDirectory, fileExists, readJsonFile, writeJsonFile } from "../utils/fs";
import type { PersistenceBackend } from "./backend";

function isExpired(fileTimestamp: string, retentionDays: number): boolean {
  const ageMs = Date.now() - new Date(fileTimestamp).getTime();
  return ageMs > retentionDays * 24 * 60 * 60 * 1000;
}

export class FilesystemPersistenceBackend implements PersistenceBackend {
  private readonly jobsDir: string;
  private readonly packsDir: string;
  private readonly auditDir: string;

  constructor(private readonly rootDir: string) {
    this.jobsDir = path.join(rootDir, "jobs");
    this.packsDir = path.join(rootDir, "packs");
    this.auditDir = path.join(rootDir, "audit");
  }

  async initialize(): Promise<void> {
    await Promise.all([ensureDirectory(this.rootDir), ensureDirectory(this.jobsDir), ensureDirectory(this.packsDir), ensureDirectory(this.auditDir)]);
  }

  async pruneExpiredData(retentionDays: number): Promise<void> {
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

    await Promise.all([cleanupDir(this.jobsDir), cleanupDir(this.packsDir), cleanupDir(this.auditDir)]);
  }

  private tenantJobDir(tenantId: string): string {
    return path.join(this.jobsDir, tenantId);
  }

  private tenantPackDir(tenantId: string): string {
    return path.join(this.packsDir, tenantId);
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

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    const payload = AuditEventSchema.parse(event);
    await writeJsonFile(this.auditPath(payload.tenantId, payload.eventId), payload);
  }

  async listAuditEvents(tenantId?: string): Promise<AuditEvent[]> {
    const root = tenantId ? path.join(this.auditDir, tenantId) : this.auditDir;
    if (!(await fileExists(root))) {
      return [];
    }

    const files = await this.collectJsonFiles(root);
    const events = await Promise.all(files.map((filePath) => readJsonFile<unknown>(filePath)));
    return events
      .map((entry) => AuditEventSchema.parse(entry))
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }

  async saveJob(job: ProcessingJob): Promise<void> {
    await ensureDirectory(this.tenantJobDir(job.tenantId));
    await writeJsonFile(this.jobPath(job.tenantId, job.jobId), ProcessingJobSchema.parse(job));
  }

  async getJob(jobId: string, tenantId: string): Promise<ProcessingJob | undefined> {
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

  async savePack(pack: StoredReproPack): Promise<void> {
    await ensureDirectory(this.tenantPackDir(pack.tenantId));
    await writeJsonFile(this.packPath(pack.tenantId, pack.ticketId), StoredReproPackSchema.parse(pack));
  }

  async getPack(ticketId: string, tenantId: string): Promise<StoredReproPack | undefined> {
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
}
