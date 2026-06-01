import { describe, expect, it } from "vitest";
import { processTicket } from "../src/pipeline/process-ticket";
import { createTestSetup } from "./helpers/test-context";

describe("issue assembler", () => {
  it("generates markdown with the required sections and sanitized JSON output", async () => {
    const { providers, logger } = await createTestSetup();
    const result = await processTicket({ fixtureId: "heavy-sanitization-payload", dryRun: true }, providers, logger);

    expect(result.markdown).toContain("## Summary");
    expect(result.markdown).toContain("## Customer complaint");
    expect(result.markdown).toContain("## Likely repro steps");
    expect(result.markdown).toContain("## Sanitized sample payload");
    expect(result.reproPack.samplePayload).toMatchObject({
      customerEmail: "[REDACTED:EMAIL]"
    });
  });
});
