# INV-5001: Invoice creation failed

## Summary
INV-5001: Invoice creation failed

## Customer complaint
Creating an invoice fails with a 500 after I submit the form.

## Likely repro steps
1. Creating an invoice fails with a 500 after I submit the form. [user_report, confidence=0.76]
2. Open /invoices/new. [telemetry, confidence=0.84]
3. Click Submit invoice on /invoices/new. [telemetry, confidence=0.84]

## Expected vs actual
- Expected: The reported action should complete without backend or network errors.
- Actual: Creating an invoice fails with a 500 after I submit the form.

## Environment
- Browser: Chrome
- Browser version: 123.0.6312.72
- Device: Desktop
- OS: macOS 14.4
- App version: 2026.03.25-web
- Build hash: build-web-742abc

## Feature flags
- `invoice_redesign` = `control` (mock-flags)

## Timeline
- 2026-03-25T08:58:41.000Z | session | page_view | Opened invoice composer on /invoices/new
- 2026-03-25T08:58:54.000Z | session | click | Submit invoice on /invoices/new
- 2026-03-25T08:58:55.000Z | session-network | POST /api/invoices | 500 Internal Server Error returned from invoice creation
- 2026-03-25T08:58:55.120Z | billing-api | Invoice creation failed | Error code INV-5001
- 2026-03-25T09:00:00.000Z | support | Ticket created | Support ticket ingested

## Logs and errors
- 2026-03-25T08:58:55.120Z | ERROR | billing-api | Invoice creation failed

## Sanitized sample payload
```json
{
  "invoiceNumber": "INV-9912",
  "currency": "USD",
  "customerEmail": "[REDACTED:EMAIL]"
}
```

## Evidence and confidence
- Overall confidence: 0.98
- Reasoning: Corroborating providers: 4/4 (+0.25); Exact identifiers captured: 5 (+0.20); Environment completeness: 6/6 (+0.15); Trace or request correlation: present (+0.15); Payload completeness: present (+0.10); Average repro-step confidence: 0.81 (+0.08); Sanitizer completed with 1 actions (+0.05)
- invoice_redesign=control (mock-flags, confidence=0.82, citation=flag:invoice_redesign)
- POST /api/invoices (session-network, confidence=0.93, citation=network:req-742)
- INV-5001: Invoice creation failed (billing-api, confidence=0.95, citation=log:req-742)

## Open questions
- none

