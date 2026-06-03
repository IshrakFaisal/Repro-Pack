import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  port: number;
  logLevel: string;
  fixtureRoot: string;
  artifactOutputDir: string;
  dataRoot: string;
  tenantConfigRoot: string;
  storageDriver: "fs" | "sqlite";
  sqliteDatabasePath: string;
  processTimeoutMs: number;
  httpTimeoutMs: number;
  maxProviderRetries: number;
  queuePollMs: number;
  queueLeaseMs: number;
  queueMaxAttempts: number;
  retentionDays: number;
  redactIps: boolean;
  redactDirectIdentifiers: boolean;
  appVersion: string;
  buildHash: string;
  apiKey?: string;
};

function toBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return value.toLowerCase() === "true";
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  return {
    port: Number(process.env.PORT ?? 3000),
    logLevel: process.env.LOG_LEVEL ?? "info",
    fixtureRoot: path.resolve(cwd, process.env.FIXTURE_ROOT ?? "fixtures/cases"),
    artifactOutputDir: path.resolve(cwd, process.env.ARTIFACT_OUTPUT_DIR ?? "artifacts"),
    dataRoot: path.resolve(cwd, process.env.DATA_ROOT ?? "data"),
    tenantConfigRoot: path.resolve(cwd, process.env.TENANT_CONFIG_ROOT ?? "tenants"),
    storageDriver: (process.env.STORAGE_DRIVER === "sqlite" ? "sqlite" : "fs"),
    sqliteDatabasePath: path.resolve(cwd, process.env.SQLITE_DATABASE_PATH ?? "data/repro-pack.sqlite"),
    processTimeoutMs: Number(process.env.PROCESS_TIMEOUT_MS ?? 2500),
    httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 5000),
    maxProviderRetries: Number(process.env.MAX_PROVIDER_RETRIES ?? 2),
    queuePollMs: Number(process.env.QUEUE_POLL_MS ?? 250),
    queueLeaseMs: Number(process.env.QUEUE_LEASE_MS ?? 30000),
    queueMaxAttempts: Number(process.env.QUEUE_MAX_ATTEMPTS ?? 3),
    retentionDays: Number(process.env.RETENTION_DAYS ?? 30),
    redactIps: toBoolean(process.env.REDACT_IPS, true),
    redactDirectIdentifiers: toBoolean(process.env.REDACT_DIRECT_IDENTIFIERS, true),
    appVersion: process.env.APP_VERSION ?? "1.0.0",
    buildHash: process.env.BUILD_HASH ?? "not available",
    apiKey: process.env.API_KEY?.trim() || undefined
  };
}
