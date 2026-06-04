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
- auth failures
- config errors for missing tenant files or unresolved secrets
- issue sync create/update spikes

Useful metrics:

- `repro_processing_duration_ms` for end-to-end ticket processing duration by tenant and outcome
- `repro_provider_fetch_total`, `repro_provider_fetch_latency_ms`, and `repro_provider_failures_total` for context-provider health
- `repro_queue_jobs_total`, `repro_queue_job_duration_ms`, and `repro_queue_job_retries_total` for async queue throughput and retry activity
- `repro_issue_sync_total` for GitHub/Jira preview, create, update, missing-config, and failure outcomes

Queue operations:

- List jobs with `GET /jobs?tenantId=<tenant>&status=failed` or `corepack pnpm cli -- jobs --tenant <tenant> --status failed`
- Inspect one job with `GET /jobs/:id?tenantId=<tenant>` or `corepack pnpm cli -- job --tenant <tenant> --id <job-id>`
- Retry only failed jobs with `POST /jobs/:id/retry` or `corepack pnpm cli -- retry-job --tenant <tenant> --id <job-id>`
- Jobs are dead-lettered after `QUEUE_MAX_ATTEMPTS` by default, or a lower per-job `maxAttempts` when supplied for async processing
- Dead-lettered jobs are terminal and are intentionally not eligible for retry
- List audit events with `GET /audit-events?tenantId=<tenant>&action=<action>&outcome=<success|error>` or `corepack pnpm cli -- audit-events --tenant <tenant> --action <action>`
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
