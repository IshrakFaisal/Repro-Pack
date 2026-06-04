import { describe, expect, it } from "vitest";
import { sanitizePayload } from "../src/sanitizer/sanitizer";
import { createTestSetup } from "./helpers/test-context";

describe("sanitizer", () => {
  it("redacts required sensitive fields while preserving payload structure", async () => {
    const { config } = await createTestSetup();
    const result = sanitizePayload(
      {
        customerEmail: "refund.user@example.test",
        phone: "+1 (202) 555-0182",
        headers: {
          authorization: "Bearer token-abcdefghijklmnopqrstuvwxyz123456",
          cookie: "sessionid=mock-cookie-value",
          "x-api-key": "mock-api-key-abcdefghijklmnopqrstuvwxyz"
        },
        ipAddress: "203.0.113.24",
        accountId: "acct-secret-01",
        userId: "user-secret-01",
        cardNumber: "4242 4242 4242 4242",
        nestedSecret: "abcdefghijklmnopqrstuvwxyz1234567890ABCD"
      },
      config
    );

    expect(result.payload).toMatchObject({
      customerEmail: "[REDACTED:EMAIL]",
      phone: "[REDACTED:PHONE]",
      headers: {
        authorization: "[REDACTED:AUTH_HEADER]",
        cookie: "[REDACTED:COOKIE]",
        "x-api-key": "[REDACTED:API_KEY]"
      },
      ipAddress: "[REDACTED:IP]",
      accountId: "[REDACTED:IDENTIFIER]",
      userId: "[REDACTED:IDENTIFIER]",
      cardNumber: "[REDACTED:PAYMENT]",
      nestedSecret: "[REDACTED:SECRET]"
    });
    expect(result.report.length).toBeGreaterThanOrEqual(8);
  });

  it("detects semantic PII, masked emails, phone words, and locale IDs", async () => {
    const { config } = await createTestSetup();
    const result = sanitizePayload(
      {
        fullName: "Jane Customer",
        dateOfBirth: "1990-01-01",
        nationalId: "BD-1234567890",
        maskedEmail: "jane.customer at example dot test",
        supportNote: "Call me at two zero two five five five zero one eight two"
      },
      config
    );

    expect(result.payload).toMatchObject({
      fullName: "[REDACTED:PII]",
      dateOfBirth: "[REDACTED:PII]",
      nationalId: "[REDACTED:IDENTIFIER]",
      maskedEmail: "[REDACTED:EMAIL]",
      supportNote: "Call me at [REDACTED:PHONE]"
    });
    expect(result.report.map((item) => item.classification)).toEqual(
      expect.arrayContaining(["semantic-pii", "locale-specific-identifier", "masked-email", "phone-words"])
    );
  });
});
