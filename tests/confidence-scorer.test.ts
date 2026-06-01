import { describe, expect, it } from "vitest";
import { ingestTicket } from "../src/ingestion/ticket-ingestion";
import { enrichContext } from "../src/enrichment/context-enrichment";
import { normalizeEvidence } from "../src/normalization/evidence-normalizer";
import { sanitizePayload } from "../src/sanitizer/sanitizer";
import { generateReproSteps } from "../src/repro/repro-step-generator";
import { scoreConfidence } from "../src/scoring/confidence-scorer";
import { createTestSetup } from "./helpers/test-context";

describe("confidence scorer", () => {
  it("assigns high confidence when multiple evidence sources correlate", async () => {
    const { providers, config } = await createTestSetup();
    const ticket = await ingestTicket({ fixtureId: "backend-trace-correlation" }, providers);
    const context = await enrichContext(ticket, providers);
    const normalized = normalizeEvidence(context);
    const sanitizedPayload = sanitizePayload(normalized.samplePayloadCandidate, config);
    const reproSteps = generateReproSteps(context, normalized);
    const confidence = scoreConfidence({ context, normalized, reproSteps, sanitizedPayload });

    expect(confidence.overall).toBeGreaterThan(0.85);
    expect(confidence.reasoning).toContain("Corroborating providers");
    expect(confidence.reasoning).toContain("Exact identifiers captured");
  });
});
