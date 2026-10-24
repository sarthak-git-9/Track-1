# Bharosa implementation roadmap

## Working branch
`test/task-1-shared-fixtures` — integrate the starter on this existing branch; do not rewrite `main`.

## Milestone order
1. **Foundation:** loopback-only FastAPI backend, extension token, origin allow-list, health state and in-memory sessions.
2. **Redaction:** deterministic candidate detection, user review, consistent placeholders, exact-match verification, re-scan, TXT/Markdown export.
3. **Site assessment:** hostname normalization, exact reviewed-domain match, lookalike heuristics, non-invasive form-metadata checks and evidence ledger.
4. **Engineering:** repeatable synthetic tests, CI, install instructions and explicit known limitations.
5. **Hardening after the vertical slice:** text-PDF extraction and fresh-PDF export; overlapping model chunks and independent verifier; reviewed official-domain data; compliant live reputation/RDAP providers; optional social-review collection; browser-level security tests.

## Guardrails
- Never read typed passwords, OTP values or card values.
- Never transmit original documents or page text to a remote reputation provider.
- No original document contents in application logs or persistent storage.
- Agents suggest candidates or explanations; code owns redaction, evidence records and verdict rules.
- Missing providers and timeouts produce `could not check`, never a clean result.
- Only synthetic PII is permitted in fixtures and demos.
- Do not call the project complete or security-audited until the missing capabilities are implemented and tested.
