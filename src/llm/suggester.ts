import { z } from "zod";
import type { AppConfig } from "../config/env";
import { sanitizePayload } from "../sanitizer/sanitizer";
import type { EvidenceItem, LlmSuggestions, ReproStep } from "../types/schemas";
import type { ResolvedTenantConfig } from "../types/integrations";
import { createAnthropicMessage } from "./client";

type MinimalLogger = {
  info: (obj: unknown, message?: string) => void;
  error: (obj: unknown, message?: string) => void;
};

const LlmStepResponseSchema = z.object({
  steps: z.array(z.string().min(1)).default([])
});

function parseSteps(text: string): string[] {
  try {
    return LlmStepResponseSchema.parse(JSON.parse(text)).steps;
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
  }
}

function buildPrompt(input: { summary: string; reproSteps: ReproStep[]; evidenceTypes: string[] }): string {
  return [
    "You are improving a developer repro pack.",
    "Use only the sanitized data below. Do not invent IDs, routes, versions, customers, or root causes.",
    "Suggest improved or additional repro steps only. Do not replace the provided heuristic steps.",
    "Return strict JSON in this shape: {\"steps\":[\"step text\"]}.",
    "",
    JSON.stringify(
      {
        sanitizedSummary: input.summary,
        heuristicSteps: input.reproSteps.map((step) => ({
          step: step.step,
          source: step.source,
          confidence: step.confidence
        })),
        availableEvidenceTypes: input.evidenceTypes
      },
      null,
      2
    )
  ].join("\n");
}

export async function suggestLlmReproSteps(input: {
  tenant: ResolvedTenantConfig | undefined;
  config: AppConfig;
  logger: MinimalLogger;
  summary: string;
  reproSteps: ReproStep[];
  evidence: EvidenceItem[];
}): Promise<LlmSuggestions> {
  const tenantId = input.tenant?.tenantId ?? "default";
  const llm = input.tenant?.llm;
  if (!llm?.enabled) {
    return null;
  }

  if (!llm.apiKey) {
    input.logger.error({ event: "llm.suggestion.skipped", tenantId, reason: "missing_api_key" });
    return null;
  }

  const sanitizedPromptInput = sanitizePayload(
    {
      summary: input.summary,
      reproSteps: input.reproSteps,
      evidenceTypes: [...new Set(input.evidence.map((item) => item.type))].sort()
    },
    input.config
  ).payload as { summary?: string; reproSteps?: ReproStep[]; evidenceTypes?: string[] };

  try {
    const prompt = buildPrompt({
      summary: sanitizedPromptInput.summary ?? "not available",
      reproSteps: sanitizedPromptInput.reproSteps ?? [],
      evidenceTypes: sanitizedPromptInput.evidenceTypes ?? []
    });
    const response = await createAnthropicMessage({
      apiKey: llm.apiKey,
      model: llm.model,
      prompt,
      timeoutMs: input.config.llmTimeoutMs
    });
    const steps = [...new Set(parseSteps(response))].slice(0, 6);
    input.logger.info({ event: "llm.suggestion.completed", tenantId, model: llm.model, stepCount: steps.length });
    return {
      steps,
      model: llm.model,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    input.logger.error({
      event: "llm.suggestion.failed",
      tenantId,
      model: llm.model,
      error: error instanceof Error ? error.message : "Unknown LLM failure"
    });
    return null;
  }
}
