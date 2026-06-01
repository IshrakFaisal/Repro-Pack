# FLAG-ROUTE-404: Route handler missing for checkout v2 session bootstrap

## Summary
FLAG-ROUTE-404: Route handler missing for checkout v2 session bootstrap

## Customer complaint
Users in this workspace cannot open checkout after we enabled the new checkout cohort.

## Likely repro steps
1. Users in this workspace cannot open checkout after we enabled the new checkout cohort. [user_report, confidence=0.76]
2. Open /checkout. [telemetry, confidence=0.84]
3. Click Launch checkout on /checkout. [telemetry, confidence=0.84]

## Expected vs actual
- Expected: The reported action should complete without backend or network errors.
- Actual: Users in this workspace cannot open checkout after we enabled the new checkout cohort.

## Environment
- Browser: Firefox
- Browser version: 124.0
- Device: Desktop
- OS: Ubuntu 24.04
- App version: 2026.03.24-web
- Build hash: build-checkout-19ab

## Feature flags
- `checkout_rewrite` = `enabled` (mock-flags)

## Timeline
- 2026-03-25T10:04:40.000Z | session | page_view | Opened checkout launcher on /checkout
- 2026-03-25T10:04:51.000Z | session | click | Launch checkout on /checkout
- 2026-03-25T10:04:52.000Z | session-network | GET /api/checkout/v2/session | 404 returned because rollout target route was missing
- 2026-03-25T10:04:52.010Z | checkout-api | Route handler missing for checkout v2 session bootstrap | Error code FLAG-ROUTE-404
- 2026-03-25T10:05:00.000Z | support | Ticket created | Support ticket ingested

## Logs and errors
- 2026-03-25T10:04:52.010Z | ERROR | checkout-api | Route handler missing for checkout v2 session bootstrap

## Sanitized sample payload
```json
{}
```

## Evidence and confidence
- Overall confidence: 0.88
- Reasoning: Corroborating providers: 4/4 (+0.25); Exact identifiers captured: 5 (+0.20); Environment completeness: 6/6 (+0.15); Trace or request correlation: present (+0.15); Payload completeness: missing (+0.00); Average repro-step confidence: 0.81 (+0.08); Sanitizer completed with 0 actions (+0.05)
- checkout_rewrite=enabled (mock-flags, confidence=0.82, citation=flag:checkout_rewrite)
- GET /api/checkout/v2/session (session-network, confidence=0.93, citation=network:req-flag-17)
- FLAG-ROUTE-404: Route handler missing for checkout v2 session bootstrap (checkout-api, confidence=0.95, citation=log:req-flag-17)

## Open questions
- none

