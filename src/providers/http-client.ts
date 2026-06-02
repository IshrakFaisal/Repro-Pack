import { setTimeout as delay } from "node:timers/promises";
import type { AppConfig } from "../config/env";

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
};

type HttpResponse<T> = {
  status: number;
  headers: Headers;
  data: T;
};

function buildRetryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
  }

  return Math.min(1000 * 2 ** attempt, 5000);
}

function isRetryable(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  return status === 408 || status === 429 || status >= 500;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly responseBody?: string
  ) {
    super(message);
  }
}

export class HttpJsonClient {
  constructor(private readonly config: AppConfig) {}

  async request<T>(url: string, options: RequestOptions = {}): Promise<HttpResponse<T>> {
    const timeoutMs = options.timeoutMs ?? this.config.httpTimeoutMs;
    const retries = options.retries ?? this.config.maxProviderRetries;
    let lastError: HttpError | undefined;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers: {
            "content-type": "application/json",
            ...(options.headers ?? {})
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal
        });
        clearTimeout(timeout);

        const rawText = await response.text();
        const data = rawText ? (JSON.parse(rawText) as T) : ({} as T);

        if (!response.ok) {
          lastError = new HttpError(`HTTP ${response.status} from ${url}`, response.status, rawText);
          if (attempt < retries && isRetryable(response.status)) {
            await delay(buildRetryDelay(response, attempt));
            continue;
          }

          throw lastError;
        }

        return {
          status: response.status,
          headers: response.headers,
          data
        };
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof HttpError) {
          throw error;
        }

        lastError = new HttpError(error instanceof Error ? error.message : "HTTP request failed");
        if (attempt < retries && isRetryable(undefined)) {
          await delay(buildRetryDelay(undefined, attempt));
          continue;
        }
      }
    }

    throw lastError ?? new HttpError("HTTP request failed");
  }
}
