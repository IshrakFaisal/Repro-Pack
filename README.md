# Support Ticket -> Repro Pack

Production-oriented TypeScript service that turns support tickets into developer-ready repro packs with normalized evidence, deterministic sanitization, repro steps, confidence scoring, review workflow, and idempotent GitHub/Jira issue sync.

## What This Project Does

- Ingests support tickets from fixture input, direct payloads, or real Zendesk ticket ids
- Enriches tickets with logs, session replay, feature flag, and release/deploy context
- Normalizes evidence into a consistent internal schema
- Redacts sensitive data before issue drafting or external sync
- Produces JSON repro packs and Markdown issue drafts
- Supports dry-run previews before any external write
- Persists jobs, provider results, review history, issue links, and audit events
- Syncs approved issues to GitHub and Jira with idempotent update behavior

## Current Integration Support

### Real adapters

- Zendesk ticket ingestion
- GitHub issue create/update
- Jira issue create/update
- Generic HTTP observability/log provider
- Generic HTTP session replay provider
- Generic HTTP feature flag provider
- Generic HTTP release/deploy provider

### Local adapters

- Fixture-based ticket and context providers for deterministic testing and local development

## Architecture

The existing pipeline remains intact and is now wrapped by a production integration layer:

1. `ticket-ingestion`
2. `context-enrichment`
3. `evidence-normalizer`
4. `sanitizer`
5. `repro-step-generator`
6. `confidence-scorer`
7. `issue-assembler`
8. `persistence + audit logging + external issue sync`

Key directories:

```text
src/
  assembly/        issue and artifact assembly
  cli/             local operator commands
  config/          app config + tenant config resolution
  enrichment/      provider orchestration
  ingestion/       support ticket normalization
  issues/          GitHub/Jira sync orchestration
  jobs/            async job execution
  normalization/   evidence normalization
  persistence/     filesystem-backed state store
  pipeline/        end-to-end processing
  providers/       fixture + production adapters
  repro/           repro step generation
  runtime/         runtime composition
  sanitizer/       deterministic redaction
  scoring/         confidence model
  server/          Fastify API
  types/           schemas and integration config
tests/             unit and integration coverage
fixtures/          fixture tickets and golden outputs
tenants/           tenant config files
```

## Quick Start

```bash
corepack pnpm install
copy .env.example .env
corepack pnpm check
corepack pnpm dev
```

## Environment Variables

Core app configuration:

- `PORT`
- `LOG_LEVEL`
- `FIXTURE_ROOT`
- `ARTIFACT_OUTPUT_DIR`
- `DATA_ROOT`
- `TENANT_CONFIG_ROOT`
- `PROCESS_TIMEOUT_MS`
- `HTTP_TIMEOUT_MS`
- `MAX_PROVIDER_RETRIES`
- `RETENTION_DAYS`
- `REDACT_IPS`
- `REDACT_DIRECT_IDENTIFIERS`
- `APP_VERSION`
- `BUILD_HASH`
- `API_KEY`

Provider credentials are referenced indirectly from tenant config files using environment variable names, for example:

- `ZENDESK_EMAIL`
- `ZENDESK_API_TOKEN`
- `GITHUB_TOKEN`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`

The tenant config never needs to contain raw secrets.

## Tenant Configuration

Create one JSON file per tenant under `TENANT_CONFIG_ROOT`, for example [tenants/example-tenant.json](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\tenants\example-tenant.json).

Example capabilities:

- `support`: Zendesk adapter
- `logs`: generic HTTP log provider
- `session`: generic HTTP session provider
- `featureFlags`: generic HTTP feature flag provider
- `release`: generic HTTP release provider
- `github`: GitHub issue sync
- `jira`: Jira issue sync

## API

### Public

- `GET /health`

### Protected when `API_KEY` is configured

- `POST /tickets/process`
- `GET /jobs/:id`
- `GET /packs`
- `GET /packs/:ticketId`
- `POST /packs/:ticketId/review`
- `POST /packs/:ticketId/sync-issues`
- `POST /issues/:ticketId/export`
- `GET /debug/ticket/:id`

Use the `x-api-key` header on protected routes.

### Process a Zendesk ticket

```json
{
  "tenantId": "acme",
  "supportTicketId": "12345",
  "dryRun": true
}
```

### Preview issue sync without writing

```json
{
  "tenantId": "acme",
  "dryRun": true,
  "targets": ["github", "jira"]
}
```

### Perform idempotent issue sync

```json
{
  "tenantId": "acme",
  "dryRun": false,
  "targets": ["github", "jira"]
}
```

## CLI

Process a local fixture:

```bash
corepack pnpm cli -- process --ticket backend-trace-correlation --dry-run
```

Process a Zendesk ticket for a tenant:

```bash
corepack pnpm cli -- process --tenant acme --support-ticket-id 12345 --dry-run
```

Approve a stored pack:

```bash
corepack pnpm cli -- review --tenant acme --ticket zendesk-12345 --status approved --reviewer qa@example.test --note "Evidence verified"
```

Preview external sync:

```bash
corepack pnpm cli -- sync-issues --tenant acme --ticket zendesk-12345
```

Write to GitHub and Jira:

```bash
corepack pnpm cli -- sync-issues --tenant acme --ticket zendesk-12345 --write
```

## Idempotency

External issue writes are designed to be repeat-safe:

- issue sync stores `issueLinks` per ticket and target
- repeated syncs update existing GitHub/Jira issues instead of creating duplicates
- hidden repro-pack markers are embedded into synced issue bodies/descriptions to help re-discovery

## Persistence and Retention

State is persisted under `DATA_ROOT`:

- `jobs/`: async processing jobs
- `packs/`: stored repro packs and provider results
- `issues/`: exported Markdown issue drafts
- `audit/`: audit events for processing, review, and issue sync

Retention cleanup runs during store initialization and removes stale data older than `RETENTION_DAYS`.

## Security Model

- Raw secrets are resolved from environment variables, not tenant config files
- All external issue sync flows use already-sanitized issue drafts
- Protected endpoints require `API_KEY` when configured
- Sanitization remains deterministic and reportable
- Audit logs record operational actions without logging raw credentials

## Testing

Run the full suite:

```bash
corepack pnpm test
```

Run build + tests:

```bash
corepack pnpm check
```

The integration suite now covers:

- fixture-based local processing
- production-like Zendesk + GitHub + Jira adapters
- rate-limit retry handling
- tenant config resolution
- idempotent issue sync behavior
- protected API routes

## Deployment Notes

Recommended production setup:

- run behind a private network or authenticated internal gateway
- set `API_KEY`
- mount persistent storage for `DATA_ROOT`
- inject provider credentials via environment variables or a secrets manager
- define one tenant file per customer/workspace under `TENANT_CONFIG_ROOT`
- monitor audit logs and storage retention

For higher-scale deployment, the next step would be replacing filesystem persistence with a database and moving background jobs to a dedicated queue/worker model.
