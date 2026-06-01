import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export type AppConfig = {
  port: number;
  logLevel: string;
  fixtureRoot: string;
  artifactOutputDir: string;
  dataRoot: string;
  processTimeoutMs: number;
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
    processTimeoutMs: Number(process.env.PROCESS_TIMEOUT_MS ?? 2500),
    redactIps: toBoolean(process.env.REDACT_IPS, true),
    redactDirectIdentifiers: toBoolean(process.env.REDACT_DIRECT_IDENTIFIERS, true),
    appVersion: process.env.APP_VERSION ?? "1.0.0",
    buildHash: process.env.BUILD_HASH ?? "not available",
    apiKey: process.env.API_KEY?.trim() || undefined
  };
}
