import fs from "node:fs/promises";
import path from "node:path";
import { createProviders } from "../src/providers/factory";
import { processTicket } from "../src/pipeline/process-ticket";
import { writeJsonFile, writeTextFile } from "../src/utils/fs";
import type { AppConfig } from "../src/config/env";

async function main() {
  const fixtureRoot = path.resolve(process.cwd(), "fixtures/cases");
  const outputRoot = path.resolve(process.cwd(), "fixtures/sample-outputs");
  const config: AppConfig = {
    port: 0,
    logLevel: "silent",
    fixtureRoot,
    artifactOutputDir: outputRoot,
    processTimeoutMs: 2500,
    redactIps: true,
    redactDirectIdentifiers: true,
    appVersion: "1.0.0",
    buildHash: "not available"
  };

  const providers = createProviders(config);
  const logger = {
    info: () => undefined,
    error: () => undefined
  };

  const ticketIds = (await fs.readdir(fixtureRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const ticketId of ticketIds) {
    const result = await processTicket({ fixtureId: ticketId, dryRun: true }, providers, logger);
    const baseDir = path.join(outputRoot, ticketId);
    await writeJsonFile(path.join(baseDir, "repro-pack.json"), result.reproPack);
    await writeTextFile(path.join(baseDir, "issue.md"), `${result.markdown}\n`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
