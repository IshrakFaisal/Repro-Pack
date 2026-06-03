import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { AppConfig } from "../config/env";
import type { ResolvedTenantConfig } from "../types/integrations";
import { PackWebhookEventSchema, type PackWebhookEvent } from "./events";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return Math.min(100 * 2 ** attempt, 1000);
}

export function signWebhookPayload(payload: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

export class WebhookDispatcher {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: MinimalLogger
  ) {}

  async dispatch(tenant: ResolvedTenantConfig | undefined, event: PackWebhookEvent): Promise<void> {
    const parsedEvent = PackWebhookEventSchema.parse(event);
    const webhook = tenant?.providers.webhook;
    if (!webhook?.enabled || !webhook.events.includes(parsedEvent.event)) {
      return;
    }

    if (!webhook.secret) {
      this.logger.error({ event: "webhook.dispatch.skipped", tenantId: parsedEvent.tenantId, reason: "missing_secret" });
      return;
    }

    const payload = JSON.stringify(parsedEvent);
    const signature = signWebhookPayload(payload, webhook.secret);
    let lastError = "Webhook dispatch failed";

    for (let attempt = 0; attempt <= this.config.maxProviderRetries; attempt += 1) {
      try {
        const response = await fetch(webhook.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-repro-signature": signature
          },
          body: payload
        });

        if (response.ok) {
          this.logger.info({
            event: "webhook.dispatch.sent",
            tenantId: parsedEvent.tenantId,
            ticketId: parsedEvent.ticketId,
            webhookEvent: parsedEvent.event
          });
          return;
        }

        lastError = `Webhook returned HTTP ${response.status}`;
        if (attempt < this.config.maxProviderRetries && isRetryable(response.status)) {
          await delay(retryDelayMs(attempt));
          continue;
        }
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Webhook transport error";
        if (attempt < this.config.maxProviderRetries && isRetryable(undefined)) {
          await delay(retryDelayMs(attempt));
          continue;
        }
      }
    }

    this.logger.error({
      event: "webhook.dispatch.failed",
      tenantId: parsedEvent.tenantId,
      ticketId: parsedEvent.ticketId,
      webhookEvent: parsedEvent.event,
      error: lastError
    });
  }
}
