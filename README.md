# Support Ticket -> Repro Pack

Production-minded TypeScript service that turns a raw support complaint into a developer-ready repro pack with evidence, sanitization, confidence scoring, review workflow, and GitHub-ready issue draft export.

## What It Does

- Ingests a support ticket from fixture input, direct payloads, or future provider integrations
- Enriches the ticket with session, logs, feature flags, and release metadata
- Normalizes evidence into a consistent internal model
- Sanitizes payloads and records a deterministic redaction report
- Drafts repro steps with explicit `user_report`, `telemetry`, or `inferred` provenance
- Scores confidence using a transparent, evidence-based formula
- Stores repro packs with review states: `draft`, `reviewed`, `approved`, `rejected`
- Exports approved issue drafts as Markdown for GitHub filing

## Why This Exists

Support tickets often arrive missing the context engineers need to act quickly. This service is designed to turn that noisy, partial input into a compact repro pack that favors:

- high signal over speculation
- auditability over hidden magic
- partial but correct output over aggressive guessing

## Stack

- Runtime: Node 22+
- Package manager: `pnpm`
- Language: TypeScript
- HTTP server: Fastify
- Validation: Zod
- Logging: pino
- Tests: Vitest
- Persistence: local filesystem for MVP durability

## Quick Start

```bash
corepack pnpm install
copy .env.example .env
corepack pnpm check
corepack pnpm dev
```

The server starts on `http://localhost:3000` by default.

## Environment

Key variables from [.env.example](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\.env.example):

- `PORT`: HTTP port
- `LOG_LEVEL`: pino log level
- `FIXTURE_ROOT`: local ticket fixture directory
- `ARTIFACT_OUTPUT_DIR`: optional output directory for explicit artifact writing
- `DATA_ROOT`: persisted jobs, packs, and exported issues
- `API_KEY`: enables API-key protection for all routes except `/health`
- `REDACT_IPS`: redact IP addresses in payloads
- `REDACT_DIRECT_IDENTIFIERS`: redact account/user/workspace identifiers

## CLI

Process a ticket synchronously:

```bash
corepack pnpm cli -- process --ticket backend-trace-correlation --dry-run
```

Queue async processing:

```bash
corepack pnpm cli -- process --ticket feature-flag-regression --dry-run --async
```

Inspect a stored pack:

```bash
corepack pnpm cli -- pack --ticket backend-trace-correlation
```

Approve a pack:

```bash
corepack pnpm cli -- review --ticket backend-trace-correlation --status approved --reviewer qa@example.test --note "Ready to file"
```

Export an approved issue draft:

```bash
corepack pnpm cli -- export-issue --ticket backend-trace-correlation
```

## HTTP API

### Public

- `GET /health`

### Protected When `API_KEY` Is Set

- `POST /tickets/process`
- `GET /jobs/:id`
- `GET /packs`
- `GET /packs/:ticketId`
- `POST /packs/:ticketId/review`
- `POST /issues/:ticketId/export`
- `GET /debug/ticket/:id`

Use the `x-api-key` header for protected routes.

Example request:

```json
{
  "fixtureId": "heavy-sanitization-payload",
  "dryRun": true,
  "async": false
}
```

## Review Workflow

Every processed repro pack is persisted and moves through one of four states:

- `draft`: generated but not reviewed yet
- `reviewed`: checked by a human reviewer
- `approved`: ready for issue export
- `rejected`: held back due to missing or conflicting evidence

Issue export is only allowed from `approved`.

## Repository Layout

```text
src/
  assembly/        artifact builders
  cli/             local operator commands
  config/          environment config
  enrichment/      provider orchestration
  ingestion/       support ticket normalization
  jobs/            async job runner
  normalization/   canonical evidence shaping
  persistence/     filesystem-backed store
  pipeline/        end-to-end processing
  providers/       provider interfaces + mock adapters
  repro/           repro-step generation
  runtime/         app runtime composition
  sanitizer/       deterministic redaction
  scoring/         confidence scoring
  server/          Fastify API
  types/           schemas and shared types
  utils/           filesystem, logging, text helpers
tests/             unit and integration tests
fixtures/          sample ticket inputs and generated outputs
scripts/           helper scripts
```

## Processing Pipeline

1. `ticket-ingestion`
2. `context-enrichment`
3. `evidence-normalizer`
4. `sanitizer`
5. `repro-step-generator`
6. `confidence-scorer`
7. `issue-assembler`
8. `persistence + review workflow`

The core orchestrator is [src/pipeline/process-ticket.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\pipeline\process-ticket.ts).

## Confidence Model

The overall confidence score is capped at `1.0` and currently weights:

- corroborating providers: `0.25`
- exact identifiers: `0.20`
- environment completeness: `0.15`
- request/trace correlation: `0.15`
- payload completeness: `0.10`
- repro-step confidence: `0.10`
- sanitizer completion: `0.05`

Each generated repro pack includes the full reasoning string so the score stays reviewable and easy to tune.

## Fixtures And Sample Outputs

Fixture cases live under [fixtures/cases](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\fixtures\cases):

- `browser-only-complaint`
- `backend-trace-correlation`
- `feature-flag-regression`
- `version-specific-mobile-issue`
- `heavy-sanitization-payload`

Golden sample outputs live under [fixtures/sample-outputs](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\fixtures\sample-outputs).

Regenerate them with:

```bash
corepack pnpm generate:samples
```

## Quality Checks

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm check
```

## Current Limits

- Real external providers are not wired yet; shipped adapters are fixture-backed
- Persistence is filesystem-based, not database-backed
- Async jobs are in-process and single-worker only
- GitHub issues are exported as Markdown drafts, not created automatically
- Jira and Slack integrations are intentionally out of scope for now
- Root-cause claims stay conservative and evidence-backed

## Next Recommended Step

The highest-value next slice is to add one real support provider and one real logs/traces provider behind the existing interfaces in [src/providers/interfaces.ts](C:\Users\USER\OneDrive\Desktop\New folder\Coding\Project no 2\src\providers\interfaces.ts), while preserving the current mock fixtures as deterministic test doubles.
