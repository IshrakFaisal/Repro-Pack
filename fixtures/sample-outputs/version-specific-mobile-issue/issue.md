# Conflicting browserVersion values

## Summary
Conflicting browserVersion values

## Customer complaint
On Safari 17.4 on iPhone 14, tapping Save after uploading a profile photo does nothing.

## Likely repro steps
1. On Safari 17.4 on iPhone 14, tapping Save after uploading a profile photo does nothing. [user_report, confidence=0.76]
2. Open /settings/profile. [telemetry, confidence=0.84]
3. Click Save profile photo on /settings/profile. [telemetry, confidence=0.84]

## Expected vs actual
- Expected: The reported workflow should complete successfully.
- Actual: On Safari 17.4 on iPhone 14, tapping Save after uploading a profile photo does nothing.

## Environment
- Browser: Safari
- Browser version: 17.4
- Device: iPhone 14
- OS: iOS 17.4
- App version: ios-web-2026.03.20
- Build hash: build-mobile-1a2b

## Feature flags
- not available

## Timeline
- 2026-03-25T11:29:11.000Z | session | page_view | Opened profile page on /settings/profile
- 2026-03-25T11:29:40.000Z | session | tap | Save profile photo on /settings/profile
- 2026-03-25T11:30:00.000Z | support | Ticket created | Support ticket ingested

## Logs and errors
- not available

## Sanitized sample payload
```json
{}
```

## Evidence and confidence
- Overall confidence: 0.51
- Reasoning: Corroborating providers: 2/4 (+0.13); Exact identifiers captured: 2 (+0.10); Environment completeness: 6/6 (+0.15); Trace or request correlation: missing (+0.00); Payload completeness: missing (+0.00); Average repro-step confidence: 0.81 (+0.08); Sanitizer completed with 0 actions (+0.05)
- Conflicting browserVersion values (normalizer, confidence=0.88, citation=conflict:browserVersion, conflict=true)
- Conflicting appVersion values (normalizer, confidence=0.88, citation=conflict:appVersion, conflict=true)

## Open questions
- Backend logs or correlated traces not available.
- Feature flag state not available.

