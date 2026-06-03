import { describe, expect, it } from "vitest";

const hasSandboxConfig = Boolean(
  process.env.SANDBOX_TENANT_ID &&
    process.env.SANDBOX_ZENDESK_TICKET_ID &&
    process.env.SANDBOX_API_KEY
);

describe.skipIf(!hasSandboxConfig)("sandbox integrations", () => {
  it("is enabled only when real sandbox credentials are present", () => {
    expect(hasSandboxConfig).toBe(true);
  });
});
