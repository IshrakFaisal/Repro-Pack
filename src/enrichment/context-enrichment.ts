import type { EnrichedContext, ProviderResultOf, SupportTicket } from "../types/schemas";
import type { ProviderSet } from "../providers/interfaces";

async function withTimeout<T>(promise: Promise<ProviderResultOf<T>>, timeoutMs: number, provider: string) {
  return Promise.race([
    promise,
    new Promise<ProviderResultOf<T>>((resolve) => {
      setTimeout(() => {
        resolve({
          provider,
          status: "error",
          fetchedAt: new Date().toISOString(),
          latencyMs: timeoutMs,
          errorSummary: `Provider timed out after ${timeoutMs}ms`
        });
      }, timeoutMs);
    })
  ]);
}

export async function enrichContext(
  ticket: SupportTicket,
  providers: ProviderSet
): Promise<EnrichedContext> {
  const timeout = providers.config.processTimeoutMs;
  const [session, logs, featureFlags, release] = await Promise.all([
    withTimeout(providers.session.fetch(ticket), timeout, providers.session.name),
    withTimeout(providers.logs.fetch(ticket), timeout, providers.logs.name),
    withTimeout(providers.featureFlags.fetch(ticket), timeout, providers.featureFlags.name),
    withTimeout(providers.release.fetch(ticket), timeout, providers.release.name)
  ]);

  return {
    ticket,
    session,
    logs,
    featureFlags,
    release
  };
}
