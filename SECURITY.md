# Security Policy

## Reporting

If you find a security issue, please do not open a public issue with exploit details. Share a private report with the repository maintainers and include:

- affected area
- reproduction steps
- expected impact
- suggested mitigation if known

## High-Risk Areas In This Project

- payload sanitization and secret redaction
- provider integrations that may expose raw support or telemetry data
- persisted repro packs and exported issue drafts
- authentication and authorization around protected routes

## Operational Guidance

- Set `API_KEY` in any non-local environment
- Do not expose `DATA_ROOT` contents publicly
- Review persisted repro packs before export
- Treat fixture payloads as sanitized examples only
- Add regression tests for every sanitization bug
