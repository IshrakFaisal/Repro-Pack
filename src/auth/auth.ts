import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env";
import type { ResolvedTenantConfig } from "../types/integrations";

export type AuthRole = "read" | "process" | "review" | "sync" | "admin";

export type AuthActor = {
  actorId: string;
  tenantId: string;
  authMethod: "global-api-key" | "tenant-api-key";
  roles: AuthRole[];
};

function getPresentedKey(request: FastifyRequest): string | undefined {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length).trim();
  }

  const headerValue = request.headers["x-api-key"];
  return typeof headerValue === "string" ? headerValue.trim() : undefined;
}

export function authenticateRequest(input: {
  request: FastifyRequest;
  config: AppConfig;
  tenant?: ResolvedTenantConfig;
}): AuthActor | undefined {
  const key = getPresentedKey(input.request);
  const tenantId = input.tenant?.tenantId ?? "default";

  if (key && input.tenant) {
    const match = input.tenant.auth.apiKeys.find((entry) => entry.resolvedSecret === key);
    if (match) {
      return {
        actorId: match.actorId,
        tenantId,
        authMethod: "tenant-api-key",
        roles: match.roles
      };
    }
  }

  if (key && input.config.apiKey && key === input.config.apiKey) {
    return {
      actorId: "local-api-key",
      tenantId,
      authMethod: "global-api-key",
      roles: ["admin", "read", "process", "review", "sync"]
    };
  }

  return undefined;
}

export function ensureRole(actor: AuthActor | undefined, role: AuthRole): AuthActor {
  if (!actor) {
    const error = new Error("Unauthorized");
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }

  if (!actor.roles.includes("admin") && !actor.roles.includes(role)) {
    const error = new Error("Forbidden");
    (error as Error & { statusCode?: number }).statusCode = 403;
    throw error;
  }

  return actor;
}

export function ensureTenantAccess(actor: AuthActor, tenantId: string): void {
  if (actor.authMethod === "global-api-key") {
    return;
  }

  if (actor.tenantId === tenantId) {
    return;
  }

  const error = new Error("Forbidden");
  (error as Error & { statusCode?: number }).statusCode = 403;
  throw error;
}
