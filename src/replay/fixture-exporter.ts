import path from "node:path";
import type { AppConfig } from "../config/env";
import type { StoredReproPack } from "../types/schemas";
import { writeJsonFile, writeTextFile } from "../utils/fs";

export type ReplayFixtureExport = {
  directory: string;
  files: string[];
};

function fixtureTicket(record: StoredReproPack) {
  return {
    ticketId: record.ticketId,
    complaintText: record.reproPack.actualBehavior,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    },
    tags: record.reproPack.regressionClassification.signals,
    status: record.status,
    customFields: {
      customerImpactScore: record.reproPack.customerImpactScore.score,
      sourceTenantId: record.tenantId
    },
    source: {
      platform: "replay-fixture",
      externalId: record.ticketId
    }
  };
}

export async function exportReplayFixture(input: {
  config: AppConfig;
  record: StoredReproPack;
  outputDir?: string;
}): Promise<ReplayFixtureExport> {
  const directory =
    input.outputDir ??
    path.join(input.config.artifactOutputDir, "replay-fixtures", input.record.tenantId, input.record.ticketId);
  const files: string[] = [];
  const writeJson = async (fileName: string, value: unknown) => {
    const filePath = path.join(directory, fileName);
    await writeJsonFile(filePath, value);
    files.push(filePath);
  };
  const writeText = async (fileName: string, value: string) => {
    const filePath = path.join(directory, fileName);
    await writeTextFile(filePath, value);
    files.push(filePath);
  };

  await writeJson("ticket.json", fixtureTicket(input.record));
  await writeJson("repro-pack.json", input.record.reproPack);
  await writeText("issue.md", `${input.record.markdown}\n`);

  if (input.record.providerResults.logs?.data) {
    await writeJson("logs.json", input.record.providerResults.logs.data);
  }
  if (input.record.providerResults.featureFlags?.data) {
    await writeJson("flags.json", input.record.providerResults.featureFlags.data);
  }
  if (input.record.providerResults.release?.data) {
    await writeJson("release.json", input.record.providerResults.release.data);
  }
  if (input.record.providerResults.session?.data) {
    await writeJson("session.json", input.record.providerResults.session.data);
  }

  await writeText(
    "README.md",
    [
      `# Replay fixture: ${input.record.ticketId}`,
      "",
      "Run this fixture locally with:",
      "",
      "```bash",
      `corepack pnpm cli -- process --ticket ${input.record.ticketId} --dry-run`,
      "```",
      "",
      "Set `FIXTURE_ROOT` to the parent directory of this fixture when replaying from another location."
    ].join("\n")
  );

  return { directory, files };
}
