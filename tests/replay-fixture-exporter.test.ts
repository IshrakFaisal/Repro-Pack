import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { processTicket } from "../src/pipeline/process-ticket";
import { exportReplayFixture } from "../src/replay/fixture-exporter";
import type { StoredReproPack } from "../src/types/schemas";
import { createTestSetup } from "./helpers/test-context";

describe("replay fixture exporter", () => {
  it("exports a sanitized stored pack as a fixture directory", async () => {
    const { providers, logger, config, artifactDir } = await createTestSetup();
    const result = await processTicket({ fixtureId: "backend-trace-correlation", dryRun: true }, providers, logger);
    const timestamp = new Date().toISOString();
    const record: StoredReproPack = {
      tenantId: "default",
      ticketId: result.ticket.ticketId,
      status: "draft",
      createdAt: timestamp,
      updatedAt: timestamp,
      dryRun: true,
      sourceLookup: { fixtureId: "backend-trace-correlation" },
      reproPack: result.reproPack,
      issueDraft: result.issueDraft,
      markdown: result.markdown,
      providerResults: {
        session: result.context.session,
        logs: result.context.logs,
        featureFlags: result.context.featureFlags,
        release: result.context.release
      },
      issueLinks: [],
      reviewHistory: []
    };

    const exported = await exportReplayFixture({
      config,
      record,
      outputDir: path.join(artifactDir, "replay", result.ticket.ticketId)
    });

    expect(exported.files.map((file) => path.basename(file))).toEqual(
      expect.arrayContaining(["ticket.json", "repro-pack.json", "issue.md", "logs.json", "session.json", "README.md"])
    );
    await expect(fs.readFile(path.join(exported.directory, "issue.md"), "utf8")).resolves.toContain("## Customer impact score");
    const ticket = JSON.parse(await fs.readFile(path.join(exported.directory, "ticket.json"), "utf8")) as { complaintText: string };
    expect(ticket.complaintText).toBe(result.reproPack.actualBehavior);
    expect(JSON.stringify(ticket)).not.toContain("context-token");
  });
});
