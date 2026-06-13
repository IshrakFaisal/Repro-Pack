# Production Runbook

## Required infrastructure

- Persistent storage:
  - `STORAGE_DRIVER=sqlite` with a durable `SQLITE_DATABASE_PATH`, or
  - `STORAGE_DRIVER=fs` only for low-scale single-instance deployments
- Private network ingress or an authenticated internal gateway
- One tenant config file per customer/workspace under `TENANT_CONFIG_ROOT`
- Secret injection through environment variables or a custom secrets-manager adapter

## Recommended deployment shape

1. Run the API service behind HTTPS.
2. Mount durable storage for `DATA_ROOT` or the SQLite database file.
3. Keep `API_KEY` only as a break-glass local/admin fallback.
4. Prefer tenant-scoped API keys in tenant config for normal production access.
5. Enable async processing for external-provider flows.

## Health and operations

- Liveness: `GET /health/live`
- Readiness: `GET /health/ready`
- Service metadata: `GET /health`
- Metrics: `GET /metrics`

Watch for:

- queue jobs stuck in `running`
- failed or `dead_lettered` jobs that repeatedly fail after explicit retry
- repeated provider retry/failure patterns
- Sentry/Datadog provider auth, timeout, or rate-limit failures
- falling confidence trend or increasing support-to-close cycle time in analytics summaries
- feature flags with repeated regression correlations
- growing triage backlog of high-impact draft packs
- auth failures
- config errors for missing tenant files or unresolved secrets
- issue sync create/update spikes

Useful metrics:

- `repro_processing_duration_ms` for end-to-end ticket processing duration by tenant and outcome
- `repro_provider_fetch_total`, `repro_provider_fetch_latency_ms`, and `repro_provider_failures_total` for context-provider health
- `repro_queue_jobs_total`, `repro_queue_job_duration_ms`, and `repro_queue_job_retries_total` for async queue throughput and retry activity
- `repro_issue_sync_total` for GitHub/Jira/Linear preview, create, update, missing-config, and failure outcomes

Queue operations:

- List jobs with `GET /jobs?tenantId=<tenant>&status=failed` or `corepack pnpm cli -- jobs --tenant <tenant> --status failed`
- Inspect one job with `GET /jobs/:id?tenantId=<tenant>` or `corepack pnpm cli -- job --tenant <tenant> --id <job-id>`
- Retry only failed jobs with `POST /jobs/:id/retry` or `corepack pnpm cli -- retry-job --tenant <tenant> --id <job-id>`
- Jobs are dead-lettered after `QUEUE_MAX_ATTEMPTS` by default, or a lower per-job `maxAttempts` when supplied for async processing
- Dead-lettered jobs are terminal and are intentionally not eligible for retry
- List audit events with `GET /audit-events?tenantId=<tenant>&action=<action>&outcome=<success|error>` or `corepack pnpm cli -- audit-events --tenant <tenant> --action <action>`
- Review analytics with `GET /analytics/summary?tenantId=<tenant>` or `corepack pnpm cli -- analytics --tenant <tenant>`
- Review triage recommendations with `GET /triage/recommendations?tenantId=<tenant>&status=draft` or `corepack pnpm cli -- triage --tenant <tenant> --status draft`
- Compare related packs with `GET /packs/<ticket>/compare/<otherTicket>?tenantId=<tenant>` or `corepack pnpm cli -- compare-packs --tenant <tenant> --left <ticket> --right <ticket>`
- Batch process support queues with `POST /tickets/batch-process` or `corepack pnpm cli -- batch-process --ticket <id> --ticket <id> --dry-run`
- Repeated retry failures usually mean the original ticket lookup, tenant config, or provider credentials need correction before retrying again

## Secret configuration

Supported secret reference shape:

```json
{ "provider": "env", "env": "ZENDESK_API_TOKEN" }
```

The runtime ships with an env-backed secret manager plus explicit adapter boundaries for:

- AWS Secrets Manager
- Google Secret Manager
- Azure Key Vault
- HashiCorp Vault

Add the provider implementation in [src/secrets/manager.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\secrets\manager.ts) and wire it into `createSecretManager()`.

## Data safety controls

- Set `DATA_RESIDENCY_MODE=offline` globally or `dataResidencyMode: "offline"` per tenant to prevent outbound LLM calls.
- Set `REQUIRE_CUSTOMER_CONSENT=true` globally or `requireCustomerConsent: true` per tenant to block repro pack creation until requests include `customerConsentConfirmed`.
- Each generated repro pack includes a redaction audit report with redaction counts, classifications, and a checksum.
- Review `sanitizationReport` and `redactionAuditReport` before approving external issue sync for regulated tenants.
- Review `automatedTestScaffold`, `similarBugHints`, `blameAssigneeSuggestion`, and `fixValidationChecklist` as generated engineering guidance. They are derived from sanitized evidence and should be confirmed by the owning engineering team.
- `customerImpactScore` is generated from sanitized tenant/user count hints, account tier, recurrence signals, severity, flags, and error evidence. Treat it as prioritization guidance, not billing or support policy truth.

## Analytics and replay

- Confidence trend groups stored packs by creation date and averages `confidence.overall`.
- Support-to-close cycle time uses first successful issue sync as the close signal, falling back to approval time when sync has not happened.
- Feature flag correlation aggregates stored packs by flag/variant, regression classification, confidence, and impact score.
- Triage recommendations rank packs by customer impact score, review state, regression classification, confidence, feature flag state, and whether approved packs have been synced externally.
- Pack comparison helps deduplicate support escalations by highlighting shared flags, error/regression signals, repro-step overlap, confidence/impact deltas, and environment drift.
- Replay fixture export writes sanitized `ticket.json`, provider fixture files when available, `repro-pack.json`, `issue.md`, and a README under `ARTIFACT_OUTPUT_DIR/replay-fixtures/<tenant>/<ticket>` by default.
- Replay exported fixtures are safe for local developer workflows because they are built from sanitized stored packs, but still keep artifact storage private by default.

## Provider notes

- Configure either `providers.support` for Zendesk or `providers.intercom` for Intercom ticket ingestion. If both are present, Intercom is selected first.
- Configure one log source per tenant path: `providers.sentry` is preferred over `providers.datadog`, and `providers.datadog` is preferred over generic `providers.logs`.
- Configure `providers.linear` to enable `linear` as a sync/export target alongside GitHub and Jira.
- Slack incoming webhooks post pending review requests with Approve/Edit/Discard action values and approval summaries. Handling interactive callbacks requires a Slack app endpoint outside this service.
- `BASE_URL` should be set when Slack review messages need direct links back to pack details.

## Retention and cleanup

- `RETENTION_DAYS` controls cleanup for jobs, packs, and audit events
- cleanup runs on store initialization
- keep retention short for sensitive environments unless policy requires otherwise

## Incident response notes

- External issue sync uses sanitized issue drafts only
- Re-run a ticket safely through preview mode before approving sync
- Audit logs capture processing, review, sync, auth failures, and request/config errors
- If provider credentials rotate, restart the service after secret updates when using env-backed secrets
- Tenant-scoped API keys cannot access another tenant's jobs, packs, reviews, exports, debug lookups, or issue sync flow; use the global key only for controlled operations/admin workflows
- Client-facing validation and internal error payloads are sanitized; inspect server logs and audit events for detailed failure context
- For residency incidents, confirm `compliance.dataResidencyMode` is `offline` and `compliance.llmUsed` is `false` in the stored repro pack.
