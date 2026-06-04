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

  it("adds smart repro metadata and keeps issue exports sanitized", async () => {
    const { providers, logger } = await createTestSetup();
    const result = await processTicket(
      {
        dryRun: true,
        ticket: {
          ticketId: "backend-trace-correlation",
          complaintText: "Customer jane.customer@example.test says checkout fails after clicking pay.",
          tags: ["regression"],
          timestamps: { createdAt: "2026-06-03T10:00:00.000Z" },
          rawSource: {
            appVersion: "0.9.0",
            browserVersion: "119"
          }
        }
      },
      providers,
      logger
    );

    expect(result.reproPack.minimalReproSequence.length).toBeGreaterThan(0);
    expect(result.reproPack.alternativeReproPaths.length).toBeGreaterThan(0);
    expect(result.reproPack.environmentDeltas.some((delta) => delta.field === "appVersion")).toBe(true);
    expect(result.reproPack.regressionClassification.classification).toBe("likely_regression");
    expect(result.reproPack.redactionAuditReport?.redactionCount).toBeGreaterThanOrEqual(0);
    expect(result.reproPack.compliance).toMatchObject({
      dataResidencyMode: "standard",
      customerConsentRequired: false
    });
    expect(result.reproPack.automatedTestScaffold.skeleton.join("\n")).toContain("describe(");
    expect(result.reproPack.similarBugHints.length).toBeGreaterThan(0);
    expect(result.reproPack.blameAssigneeSuggestion.rationale).toContain("Suggested");
    expect(result.reproPack.fixValidationChecklist.length).toBeGreaterThan(0);
    expect(result.reproPack.customerImpactScore.score).toBeGreaterThan(0);
    expect(result.issueDraft.body).toContain("## Redaction audit report");
    expect(result.issueDraft.body).toContain("## Automated test scaffold");
    expect(result.issueDraft.body).toContain("## Similar bug dedupe hints");
    expect(result.issueDraft.body).toContain("## Blame-based assignee suggestion");
    expect(result.issueDraft.body).toContain("## Fix validation checklist");
    expect(result.issueDraft.body).toContain("## Customer impact score");
    expect(result.issueDraft.body).not.toContain("jane.customer@example.test");
    expect(result.issueDraft.body).toContain("[REDACTED:EMAIL]");
  });

  it("blocks repro generation when customer consent is required but missing", async () => {
    const { providers, logger } = await createTestSetup();
    providers.config.requireCustomerConsent = true;

    await expect(
      processTicket({ fixtureId: "browser-only-complaint", dryRun: true }, providers, logger)
    ).rejects.toMatchObject({
      code: "customer_consent_required",
      statusCode: 403
    });
  });
});
