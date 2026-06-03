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
- repeated provider retry/failure patterns
- auth failures
- config errors for missing tenant files or unresolved secrets
- issue sync create/update spikes

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

## Retention and cleanup

- `RETENTION_DAYS` controls cleanup for jobs, packs, and audit events
- cleanup runs on store initialization
- keep retention short for sensitive environments unless policy requires otherwise

## Incident response notes

- External issue sync uses sanitized issue drafts only
- Re-run a ticket safely through preview mode before approving sync
- Audit logs capture processing, review, sync, auth failures, and request/config errors
- If provider credentials rotate, restart the service after secret updates when using env-backed secrets
