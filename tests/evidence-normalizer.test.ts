import { describe, expect, it } from "vitest";
import { ingestTicket } from "../src/ingestion/ticket-ingestion";
import { enrichContext } from "../src/enrichment/context-enrichment";
import { normalizeEvidence } from "../src/normalization/evidence-normalizer";
import { createTestSetup } from "./helpers/test-context";

describe("evidence normalizer", () => {
  it("surfaces conflicting evidence instead of silently resolving it", async () => {
    const { providers } = await createTestSetup();
    const ticket = await ingestTicket({ fixtureId: "version-specific-mobile-issue" }, providers);
    const context = await enrichContext(ticket, providers);
    const normalized = normalizeEvidence(context);

    expect(normalized.evidence.some((item) => item.conflict)).toBe(true);
    expect(normalized.evidence.find((item) => item.conflict)?.detail).toContain("provider data reported");
  });
});
