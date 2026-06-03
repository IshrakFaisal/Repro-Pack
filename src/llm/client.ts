import { z } from "zod";

const AnthropicMessageResponseSchema = z.object({
  content: z
    .array(
      z.object({
        type: z.string(),
        text: z.string().optional()
      })
    )
    .default([])
});

export type AnthropicMessageInput = {
  apiKey: string;
  model: string;
  prompt: string;
  timeoutMs: number;
};

export async function createAnthropicMessage(input: AnthropicMessageInput): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 600,
        temperature: 0.1,
        messages: [
          {
            role: "user",
            content: input.prompt
          }
        ]
      }),
      signal: controller.signal
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`Anthropic request failed with HTTP ${response.status}`);
    }

    const parsed = AnthropicMessageResponseSchema.parse(JSON.parse(rawText));
    return parsed.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();
  } finally {
    clearTimeout(timeout);
  }
}
