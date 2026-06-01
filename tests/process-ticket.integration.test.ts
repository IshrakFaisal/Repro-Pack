import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { processTicket } from "../src/pipeline/process-ticket";
import { createTestSetup } from "./helpers/test-context";

describe("process ticket integration", () => {
  it("returns a partial but valid repro pack when provider data is sparse", async () => {
    const { providers, logger } = await createTestSetup();
    const result = await processTicket({ fixtureId: "browser-only-complaint", dryRun: true }, providers, logger);

    expect(result.reproPack.environment.browser).toBe("Chrome");
    expect(result.reproPack.environment.appVersion).toBe("not available");
    expect(result.reproPack.logs).toEqual([]);
    expect(result.reproPack.featureFlags).toEqual([]);
    expect(result.artifactPaths).toEqual({});
  });

  it("writes artifacts only when explicitly requested and not in dry-run mode", async () => {
    const { providers, logger, artifactDir } = await createTestSetup();
    const result = await processTicket(
      { fixtureId: "backend-trace-correlation", writeArtifacts: true, dryRun: false },
      providers,
      logger
    );

    expect(result.artifactPaths.json).toBeDefined();
    expect(result.artifactPaths.markdown).toBeDefined();
    const jsonFile = path.join(artifactDir, "backend-trace-correlation", "repro-pack.json");
    const markdownFile = path.join(artifactDir, "backend-trace-correlation", "issue.md");
    await expect(fs.readFile(jsonFile, "utf8")).resolves.toContain("\"ticketId\": \"backend-trace-correlation\"");
    await expect(fs.readFile(markdownFile, "utf8")).resolves.toContain("## Evidence and confidence");
  });
});
