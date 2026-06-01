import { describe, expect, it } from "vitest";
import { normalizeSupportTicket } from "../src/ingestion/ticket-ingestion";

describe("ticket normalization", () => {
  it("normalizes alternate field names into the canonical support ticket schema", () => {
    const ticket = normalizeSupportTicket({
      id: "ticket-123",
      complaint: "Export fails after I click the button.",
      user_id: "user-1",
      account_id: "acct-1",
      workspace_id: "ws-1",
      created_at: "2026-03-25T00:00:00.000Z",
      agentNotes: ["Escalated by support"],
      attachments: [{ filename: "error.png", mimeType: "image/png" }]
    });

    expect(ticket.ticketId).toBe("ticket-123");
    expect(ticket.complaintText).toBe("Export fails after I click the button.");
    expect(ticket.userId).toBe("user-1");
    expect(ticket.timestamps.createdAt).toBe("2026-03-25T00:00:00.000Z");
    expect(ticket.supportAgentNotes).toEqual(["Escalated by support"]);
    expect(ticket.attachments[0]?.name).toBe("error.png");
  });
});
