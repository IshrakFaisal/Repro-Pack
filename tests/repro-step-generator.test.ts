import { describe, expect, it } from "vitest";
import { ingestTicket } from "../src/ingestion/ticket-ingestion";
import { enrichContext } from "../src/enrichment/context-enrichment";
import { normalizeEvidence } from "../src/normalization/evidence-normalizer";
import { generateReproSteps } from "../src/repro/repro-step-generator";
import { createTestSetup } from "./helpers/test-context";

describe("repro step generator", () => {
  it("produces user-reported and telemetry-backed repro steps", async () => {
    const { providers } = await createTestSetup();
    const ticket = await ingestTicket({ fixtureId: "backend-trace-correlation" }, providers);
    const context = await enrichContext(ticket, providers);
    const normalized = normalizeEvidence(context);
    const steps = generateReproSteps(context, normalized);

    expect(steps.some((step) => step.source === "user_report")).toBe(true);
    expect(steps.some((step) => step.source === "telemetry")).toBe(true);
    expect(steps[0]?.confidence).toBeGreaterThan(0.5);
  });
});
