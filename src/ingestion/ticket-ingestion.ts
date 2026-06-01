import { z } from "zod";
import { SupportTicketSchema, type SupportTicket } from "../types/schemas";
import { normalizeWhitespace } from "../utils/text";
import type { ProcessRequestInput, ProviderSet } from "../providers/interfaces";

const RawTicketSchema = z.record(z.unknown());

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function normalizeSupportTicket(rawTicket: unknown): SupportTicket {
  if (SupportTicketSchema.safeParse(rawTicket).success) {
    return SupportTicketSchema.parse(rawTicket);
  }

  const raw = RawTicketSchema.parse(rawTicket);
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments
        .map((item) => {
          if (typeof item !== "object" || item === null) {
            return undefined;
          }

          const candidate = item as Record<string, unknown>;
          return {
            name: asString(candidate.name) ?? asString(candidate.filename) ?? "attachment",
            type: asString(candidate.type) ?? asString(candidate.mimeType) ?? "unknown",
            url: asString(candidate.url),
            description: asString(candidate.description)
          };
        })
        .filter(Boolean)
    : [];

  return SupportTicketSchema.parse({
    ticketId: asString(raw.ticketId) ?? asString(raw.id) ?? asString(raw.ticket_id) ?? "unknown-ticket",
    complaintText: normalizeWhitespace(
      asString(raw.complaintText) ??
        asString(raw.customerComplaint) ??
        asString(raw.complaint) ??
        asString(raw.description) ??
        "not available"
    ),
    userId: asString(raw.userId) ?? asString(raw.user_id),
    accountId: asString(raw.accountId) ?? asString(raw.account_id),
    workspaceId: asString(raw.workspaceId) ?? asString(raw.workspace_id),
    timestamps: {
      createdAt: asString(raw.createdAt) ?? asString(raw.created_at),
      updatedAt: asString(raw.updatedAt) ?? asString(raw.updated_at),
      occurredAt: asString(raw.occurredAt) ?? asString(raw.occurred_at)
    },
    attachments,
    supportAgentNotes: [
      ...asStringArray(raw.supportAgentNotes),
      ...asStringArray(raw.agentNotes),
      ...asStringArray(raw.internalNotes)
    ],
    severity: asString(raw.severity),
    priority: asString(raw.priority),
    expectedBehavior: asString(raw.expectedBehavior),
    actualBehavior: asString(raw.actualBehavior),
    source: {
      platform: asString(raw.platform) ?? asString(raw.sourcePlatform),
      externalId: asString(raw.externalId)
    },
    rawSource: raw
  });
}

export async function ingestTicket(
  input: ProcessRequestInput,
  providers: ProviderSet
): Promise<SupportTicket> {
  if (input.ticket) {
    return normalizeSupportTicket(input.ticket);
  }

  if (input.fixtureId) {
    return providers.support.loadTicket({ fixtureId: input.fixtureId });
  }

  if (input.ticketPath) {
    return providers.support.loadTicket({ ticketPath: input.ticketPath });
  }

  throw new Error("A ticket payload, fixtureId, or ticketPath is required");
}
