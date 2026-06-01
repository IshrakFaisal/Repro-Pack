import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import type { AppConfig } from "../../src/config/env";
import { createProviders } from "../../src/providers/factory";

export async function createTestSetup() {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "repro-pack-test-"));
  const config: AppConfig = {
    port: 0,
    logLevel: "silent",
    fixtureRoot: path.resolve(process.cwd(), "fixtures/cases"),
    artifactOutputDir: artifactDir,
    dataRoot: path.join(artifactDir, "data"),
    processTimeoutMs: 2500,
    redactIps: true,
    redactDirectIdentifiers: true,
    appVersion: "1.0.0-test",
    buildHash: "build-test",
    apiKey: "test-api-key"
  };

  return {
    config,
    providers: createProviders(config),
    artifactDir,
    logger: {
      info: () => undefined,
      error: () => undefined
    }
  };
}
