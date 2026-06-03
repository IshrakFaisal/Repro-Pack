import { z } from "zod";
import { WebhookEventNameSchema } from "../types/integrations";

export const PackWebhookEventSchema = z.object({
  event: WebhookEventNameSchema,
  tenantId: z.string(),
  ticketId: z.string(),
  status: z.enum(["processed", "approved", "synced"]),
  confidence: z.number().min(0).max(1),
  timestamp: z.string()
});

export type PackWebhookEvent = z.infer<typeof PackWebhookEventSchema>;
