import path from "node:path";
import type { AuditEvent } from "../types/integrations";
import { AuditEventSchema } from "../types/integrations";
import { ProcessingJobSchema, StoredReproPackSchema, type ProcessingJob, type StoredReproPack } from "../types/schemas";
import { ensureDirectory } from "../utils/fs";
import type { PersistenceBackend } from "./backend";

type SqliteModule = {
  DatabaseSync: new (location: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): { data?: string } | undefined;
      all(...params: unknown[]): Array<{ data?: string }>;
    };
  };
};

async function loadSqlite(): Promise<SqliteModule> {
  return (await import("node:sqlite")) as SqliteModule;
}

export class SqlitePersistenceBackend implements PersistenceBackend {
  private db?: InstanceType<SqliteModule["DatabaseSync"]>;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await ensureDirectory(path.dirname(this.filePath));
    const sqlite = await loadSqlite();
    this.db = new sqlite.DatabaseSync(this.filePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        tenant_id TEXT NOT NULL,
        job_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tenant_id, job_id)
      );
      CREATE TABLE IF NOT EXISTS packs (
        tenant_id TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (tenant_id, ticket_id)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        tenant_id TEXT NOT NULL,
        event_id TEXT NOT NULL PRIMARY KEY,
        timestamp TEXT NOT NULL,
        data TEXT NOT NULL
      );
    `);
  }

  async pruneExpiredData(input: { tenantId: string; retentionDays: number; dryRun?: boolean }): Promise<number> {
    const db = this.requireDb();
    const cutoff = new Date(Date.now() - input.retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const jobs = this.listJobs(input.tenantId);
    const packs = this.listPacks(input.tenantId);
    const auditEvents = this.listAuditEvents(input.tenantId);
    const [jobRows, packRows, auditRows] = await Promise.all([jobs, packs, auditEvents]);
    const deletedCount =
      jobRows.filter((job) => job.updatedAt < cutoff).length +
      packRows.filter((pack) => pack.updatedAt < cutoff).length +
      auditRows.filter((event) => event.timestamp < cutoff).length;

    if (!input.dryRun) {
      db.prepare("DELETE FROM jobs WHERE tenant_id = ? AND updated_at < ?").run(input.tenantId, cutoff);
      db.prepare("DELETE FROM packs WHERE tenant_id = ? AND updated_at < ?").run(input.tenantId, cutoff);
      db.prepare("DELETE FROM audit_events WHERE tenant_id = ? AND timestamp < ?").run(input.tenantId, cutoff);
    }

    return deletedCount;
  }

  async listJobs(tenantId?: string): Promise<ProcessingJob[]> {
    const db = this.requireDb();
    const rows = tenantId
      ? db.prepare("SELECT data FROM jobs WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId)
      : db.prepare("SELECT data FROM jobs ORDER BY created_at DESC").all();
    return rows.map((row) => ProcessingJobSchema.parse(JSON.parse(row.data ?? "{}")));
  }

  async getJob(jobId: string, tenantId: string): Promise<ProcessingJob | undefined> {
    const db = this.requireDb();
    const row = db.prepare("SELECT data FROM jobs WHERE tenant_id = ? AND job_id = ?").get(tenantId, jobId);
    return row?.data ? ProcessingJobSchema.parse(JSON.parse(row.data)) : undefined;
  }

  async saveJob(job: ProcessingJob): Promise<void> {
    const db = this.requireDb();
    const payload = ProcessingJobSchema.parse(job);
    db.prepare(
      `
        INSERT INTO jobs (tenant_id, job_id, created_at, updated_at, data)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tenant_id, job_id)
        DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
      `
    ).run(payload.tenantId, payload.jobId, payload.createdAt, payload.updatedAt, JSON.stringify(payload));
  }

  async listPacks(tenantId?: string): Promise<StoredReproPack[]> {
    const db = this.requireDb();
    const rows = tenantId
      ? db.prepare("SELECT data FROM packs WHERE tenant_id = ? ORDER BY updated_at DESC").all(tenantId)
      : db.prepare("SELECT data FROM packs ORDER BY updated_at DESC").all();
    return rows.map((row) => StoredReproPackSchema.parse(JSON.parse(row.data ?? "{}")));
  }

  async getPack(ticketId: string, tenantId: string): Promise<StoredReproPack | undefined> {
    const db = this.requireDb();
    const row = db.prepare("SELECT data FROM packs WHERE tenant_id = ? AND ticket_id = ?").get(tenantId, ticketId);
    return row?.data ? StoredReproPackSchema.parse(JSON.parse(row.data)) : undefined;
  }

  async savePack(pack: StoredReproPack): Promise<void> {
    const db = this.requireDb();
    const payload = StoredReproPackSchema.parse(pack);
    db.prepare(
      `
        INSERT INTO packs (tenant_id, ticket_id, updated_at, data)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, ticket_id)
        DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data
      `
    ).run(payload.tenantId, payload.ticketId, payload.updatedAt, JSON.stringify(payload));
  }

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    const db = this.requireDb();
    const payload = AuditEventSchema.parse(event);
    db.prepare(
      `
        INSERT INTO audit_events (tenant_id, event_id, timestamp, data)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id)
        DO UPDATE SET timestamp = excluded.timestamp, data = excluded.data
      `
    ).run(payload.tenantId, payload.eventId, payload.timestamp, JSON.stringify(payload));
  }

  async listAuditEvents(tenantId?: string): Promise<AuditEvent[]> {
    const db = this.requireDb();
    const rows = tenantId
      ? db.prepare("SELECT data FROM audit_events WHERE tenant_id = ? ORDER BY timestamp DESC").all(tenantId)
      : db.prepare("SELECT data FROM audit_events ORDER BY timestamp DESC").all();
    return rows.map((row) => AuditEventSchema.parse(JSON.parse(row.data ?? "{}")));
  }

  private requireDb(): InstanceType<SqliteModule["DatabaseSync"]> {
    if (!this.db) {
      throw new Error("SQLite backend has not been initialized");
    }
    return this.db;
  }
}
