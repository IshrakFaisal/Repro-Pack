# Support Ticket -> Repro Pack

Production-ready TypeScript service for turning support tickets into developer-ready repro packs with sanitized evidence, reproducible context, review workflow, and idempotent GitHub/Jira sync.

## What changed

This repo now supports:

- fixture and direct-input local development
- real Zendesk ingestion
- real GitHub and Jira sync adapters
- generic HTTP adapters for logs, session replay, feature flags, and release metadata
- tenant-aware auth and access control
- durable async job processing with restart recovery
- pluggable persistence with filesystem and SQLite backends
- secrets-manager abstraction with env-backed resolution by default
- audit logging, retention cleanup, health endpoints, and metrics

## Architecture

The main pipeline is unchanged:

1. `ticket-ingestion`
2. `context-enrichment`
3. `evidence-normalizer`
4. `sanitizer`
5. `repro-step-generator`
6. `confidence-scorer`
7. `issue-assembler`

Production seams added around that pipeline:

- `src/auth`: tenant-aware auth and role checks
- `src/jobs`: durable queue polling and worker execution
- `src/persistence`: storage backend interface plus filesystem and SQLite implementations
- `src/providers`: fixture adapters and real integration adapters
- `src/secrets`: secret-manager abstraction
- `src/observability`: metrics and error classification

## Local run

```bash
corepack pnpm install
copy .env.example .env
corepack pnpm typecheck
corepack pnpm test
corepack pnpm dev
```

Local fixture processing:

```bash
corepack pnpm cli -- process --ticket backend-trace-correlation --dry-run
```

Local async processing:

```bash
corepack pnpm cli -- process --ticket feature-flag-regression --dry-run --async
```

## Environment variables

Core runtime:

- `PORT`
- `LOG_LEVEL`
- `FIXTURE_ROOT`
- `ARTIFACT_OUTPUT_DIR`
- `DATA_ROOT`
- `TENANT_CONFIG_ROOT`
- `STORAGE_DRIVER`
- `SQLITE_DATABASE_PATH`
- `PROCESS_TIMEOUT_MS`
- `HTTP_TIMEOUT_MS`
- `MAX_PROVIDER_RETRIES`
- `QUEUE_POLL_MS`
- `QUEUE_LEASE_MS`
- `QUEUE_MAX_ATTEMPTS`
- `RETENTION_DAYS`
- `REDACT_IPS`
- `REDACT_DIRECT_IDENTIFIERS`
- `DATA_RESIDENCY_MODE`
- `REQUIRE_CUSTOMER_CONSENT`
- `APP_VERSION`
- `BUILD_HASH`
- `API_KEY`

Provider and tenant secrets are referenced from tenant config files and resolved at runtime. The shipped default is env-backed secret resolution.

## Tenant configuration

See [tenants/example-tenant.json](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\tenants\example-tenant.json).

Tenant config can define:

- `auth.apiKeys`
- `dataResidencyMode`
- `requireCustomerConsent`
- `llm`
- `providers.support`
- `providers.logs`
- `providers.session`
- `providers.featureFlags`
- `providers.release`
- `providers.github`
- `providers.jira`

Example secret ref:

```json
{ "provider": "env", "env": "GITHUB_TOKEN" }
```

## API

Public endpoints:

- `GET /health`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

Protected endpoints:

- `POST /tickets/process`
- `GET /jobs`
- `GET /jobs/:id`
- `POST /jobs/:id/retry`
- `GET /audit-events`
- `GET /packs`
- `GET /packs/:ticketId`
- `POST /packs/:ticketId/review`
- `POST /packs/:ticketId/sync-issues`
- `POST /issues/:ticketId/export`
- `GET /debug/ticket/:id`

Auth options:

- global `API_KEY` for local/dev fallback
- tenant-scoped API keys from tenant config for production use
- tenant-scoped API keys can only read or mutate their own tenant; the global key can inspect all tenants for operations work

## CLI

Fixture:

```bash
corepack pnpm cli -- process --ticket browser-only-complaint --dry-run
```

Zendesk:

```bash
corepack pnpm cli -- process --tenant acme --support-ticket-id 12345 --dry-run
```

List jobs:

```bash
corepack pnpm cli -- jobs --tenant acme --status failed
```

Retry a failed async job:

```bash
corepack pnpm cli -- retry-job --tenant acme --id <job-id>
```

List audit events:

```bash
corepack pnpm cli -- audit-events --tenant acme --action job.dead_lettered --outcome error
```

Search packs:

```bash
corepack pnpm cli -- packs --tenant acme --search checkout --sort confidence --direction desc
```

Approve:

```bash
corepack pnpm cli -- review --tenant acme --ticket zendesk-12345 --status approved --reviewer support-ops
```

Preview sync:

```bash
corepack pnpm cli -- sync-issues --tenant acme --ticket zendesk-12345
```

Write sync:

```bash
corepack pnpm cli -- sync-issues --tenant acme --ticket zendesk-12345 --write
```

## Production deployment

Recommended baseline:

1. Set `STORAGE_DRIVER=sqlite` and mount durable storage for `SQLITE_DATABASE_PATH`.
2. Put the API behind HTTPS and an internal gateway.
3. Use tenant-scoped API keys instead of relying only on global `API_KEY`.
4. Keep tenant configs in a controlled deploy artifact or mounted config directory.
5. Inject provider secrets via env vars now, or plug in a real secrets manager.
6. Use async processing for real provider workflows.

Operational details are in [docs/production-runbook.md](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\docs\production-runbook.md).

## Idempotency and safety

- External issue sync only uses sanitized issue drafts.
- GitHub sync re-discovers issues by stored link, marker search, and fallback list scan.
- Jira sync re-discovers issues by stored link and marker search.
- Dry-run remains the default safe review flow.
- Audit events are recorded for processing, review, sync, auth failures, and request/config errors.
- Failed async jobs can be retried explicitly; non-failed jobs are not moved back to the queue.
- Repeatedly failing async jobs are dead-lettered after `QUEUE_MAX_ATTEMPTS` or per-job `maxAttempts`.
- Pack list responses can be filtered by `tenantId`, `status`, and `search`; sorted by `updatedAt`, `createdAt`, `ticketId`, or `confidence`; and paged with `limit` and `offset`.
- API validation and internal-error responses are sanitized so implementation details are kept in logs, not client payloads.
- Repro packs include a minimal repro sequence, alternative repro paths, environment deltas, regression/new-bug classification, redaction audit report, and compliance summary.
- `DATA_RESIDENCY_MODE=offline` and tenant `dataResidencyMode: "offline"` disable outbound LLM repro suggestions.
- `REQUIRE_CUSTOMER_CONSENT=true` or tenant `requireCustomerConsent: true` blocks pack creation until `customerConsentConfirmed` is supplied.
- Redaction covers regex patterns, sensitive field names, locale-specific identifiers, masked emails, and phone numbers written as words.

## Testing

Standard checks:

```bash
corepack pnpm typecheck
corepack pnpm test
```

The suite covers:

- normalization and sanitization
- smarter repro sequencing, environment deltas, regression classification, and redaction audit metadata
- markdown/json artifact generation
- local HTTP and async job flows
- real-adapter style integration tests with mocked Zendesk/GitHub/Jira backends
- tenant auth behavior and cross-tenant access denial
- durable job recovery and dead-letter transitions
- failed job retry, audit listing, pack filtering/search/sort, and sanitized API errors
- offline LLM gating and customer-consent enforcement
- optional sandbox test scaffolding when real env vars are present

## Extending providers

- Add or update a provider in [src/providers/interfaces.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\providers\interfaces.ts)
- Implement the adapter under [src/providers](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\providers)
- Register it in [src/providers/factory.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\providers\factory.ts)
- Extend the tenant config schema in [src/types/integrations.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\types\integrations.ts)

## Current limits

- SQLite is the included production-ready storage backend; large multi-instance deployments should swap in a shared database backend behind the storage interface.
- The queue is durable and restart-safe but still in-process; distributed workers would be a next step for horizontal scale.
- Cloud secret managers are adapter boundaries today, not bundled SDK integrations.
