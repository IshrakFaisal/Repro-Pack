# RFND-422: Refund replay rejected due to payload validation failure

## Summary
RFND-422: Refund replay rejected due to payload validation failure

## Customer complaint
Webhook replay fails when I submit a refund request from the admin panel.

## Likely repro steps
1. Webhook replay fails when I submit a refund request from the admin panel. [user_report, confidence=0.76]
2. Open /admin/refunds. [telemetry, confidence=0.84]
3. Click Submit refund request on /admin/refunds. [telemetry, confidence=0.84]

## Expected vs actual
- Expected: The reported action should complete without backend or network errors.
- Actual: Webhook replay fails when I submit a refund request from the admin panel.

## Environment
- Browser: Chrome
- Browser version: 124.0.6367.91
- Device: Desktop
- OS: Windows 11
- App version: 2026.03.25-admin
- Build hash: build-refund-4d3f

## Feature flags
- `refund_replay` = `enabled` (mock-flags)

## Timeline
- 2026-03-25T11:58:25.000Z | session | page_view | Opened refund request drawer on /admin/refunds
- 2026-03-25T11:58:33.000Z | session | click | Submit refund request on /admin/refunds
- 2026-03-25T11:58:34.000Z | session-network | POST /api/refunds/replay | 422 validation error from refund replay endpoint
- 2026-03-25T11:58:34.020Z | refund-api | Refund replay rejected due to payload validation failure | Error code RFND-422
- 2026-03-25T12:00:00.000Z | support | Ticket created | Support ticket ingested

## Logs and errors
- 2026-03-25T11:58:34.020Z | ERROR | refund-api | Refund replay rejected due to payload validation failure

## Sanitized sample payload
```json
{
  "customerEmail": "[REDACTED:EMAIL]",
  "phone": "[REDACTED:PHONE]",
  "headers": {
    "authorization": "[REDACTED:AUTH_HEADER]",
    "cookie": "[REDACTED:COOKIE]",
    "x-api-key": "[REDACTED:API_KEY]"
  },
  "ipAddress": "[REDACTED:IP]",
  "accountId": "[REDACTED:IDENTIFIER]",
  "userId": "[REDACTED:IDENTIFIER]",
  "cardNumber": "[REDACTED:PAYMENT]",
  "nestedSecret": "[REDACTED:SECRET]"
}
```

## Evidence and confidence
- Overall confidence: 0.98
- Reasoning: Corroborating providers: 4/4 (+0.25); Exact identifiers captured: 5 (+0.20); Environment completeness: 6/6 (+0.15); Trace or request correlation: present (+0.15); Payload completeness: present (+0.10); Average repro-step confidence: 0.81 (+0.08); Sanitizer completed with 10 actions (+0.05)
- refund_replay=enabled (mock-flags, confidence=0.82, citation=flag:refund_replay)
- POST /api/refunds/replay (session-network, confidence=0.93, citation=network:req-secret-88)
- RFND-422: Refund replay rejected due to payload validation failure (refund-api, confidence=0.95, citation=log:req-secret-88)

## Open questions
- none

