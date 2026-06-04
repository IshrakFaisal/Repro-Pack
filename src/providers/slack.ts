import { setTimeout as delay } from "node:timers/promises";
import type { AppConfig } from "../config/env";
import type { ResolvedTenantConfig } from "../types/integrations";
import type { NotificationProvider } from "./interfaces";

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

export class SlackNotificationProvider implements NotificationProvider {
  name = "slack";

  constructor(
    private readonly tenant: ResolvedTenantConfig,
    private readonly config: AppConfig,
    private readonly logger: MinimalLogger
  ) {}

  private async postWebhook(input: { tenantId: string; ticketId: string; body: unknown; eventName: string }): Promise<void> {
    const slack = this.tenant.providers.slack;
    if (!slack?.enabled) {
      return;
    }

    if (!slack.webhookUrl) {
      this.logger.error({ event: "slack.notification.skipped", tenantId: input.tenantId, reason: "missing_webhook_url" });
      return;
    }

    let lastError = "Slack webhook failed";
    for (let attempt = 0; attempt <= this.config.maxProviderRetries; attempt += 1) {
      try {
        const response = await fetch(slack.webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input.body)
        });

        if (response.ok) {
          this.logger.info({ event: input.eventName, tenantId: input.tenantId, ticketId: input.ticketId });
          return;
        }

        lastError = `Slack webhook returned HTTP ${response.status}`;
        if (attempt < this.config.maxProviderRetries && isRetryable(response.status)) {
          await delay(retryDelayMs(attempt));
          continue;
        }
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Slack webhook transport error";
        if (attempt < this.config.maxProviderRetries && isRetryable(undefined)) {
          await delay(retryDelayMs(attempt));
          continue;
        }
      }
    }

    this.logger.error({
      event: "slack.notification.failed",
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      error: lastError
    });
  }

  async postReviewRequest(input: {
    tenantId: string;
    tenantName: string;
    ticketId: string;
    summary: string;
    confidence: number;
    packUrl?: string;
  }): Promise<void> {
    const slack = this.tenant.providers.slack;
    if (!slack?.enabled) {
      return;
    }

    const body = {
      channel: slack.channel,
      text: `Review requested for repro pack ${input.ticketId}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Review requested:* ${input.ticketId}\n*Tenant:* ${input.tenantName}\n*Confidence:* ${input.confidence.toFixed(2)}\n${input.summary}`
          }
        },
        ...(input.packUrl
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `<${input.packUrl}|Open repro pack>`
                }
              }
            ]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve" },
              style: "primary",
              value: `approve:${input.tenantId}:${input.ticketId}`
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Edit" },
              value: `edit:${input.tenantId}:${input.ticketId}`
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Discard" },
              style: "danger",
              value: `discard:${input.tenantId}:${input.ticketId}`
            }
          ]
        }
      ]
    };

    await this.postWebhook({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      body,
      eventName: "slack.review_request.sent"
    });
  }

  async postPackApproved(input: {
    tenantId: string;
    tenantName: string;
    ticketId: string;
    confidence: number;
    reviewer: string;
    packUrl?: string;
  }): Promise<void> {
    const slack = this.tenant.providers.slack;
    if (!slack?.enabled) {
      return;
    }

    const text = [
      `Repro pack approved for ${input.ticketId}`,
      `Tenant: ${input.tenantName}`,
      `Confidence: ${input.confidence.toFixed(2)}`,
      `Reviewer: ${input.reviewer}`,
      input.packUrl ? `Pack: ${input.packUrl}` : undefined
    ]
      .filter(Boolean)
      .join("\n");

    const body = {
      channel: slack.channel,
      text
    };

    await this.postWebhook({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      body,
      eventName: "slack.notification.sent"
    });
  }
}
