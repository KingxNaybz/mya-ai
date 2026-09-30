# Static Guard Tests

Encode hard invariants as source-scanning tests in `tests/command-center/shell.test.mjs`.

Current guards:
- `future/` never references `sample-data.js` / `SAMPLE_DATA`
- `sw.js` never handles `/api/`
- Every `MyaData.SOURCES` URL maps to an existing `api/*.ts`
- `core.css` byte-identical to its git baseline
- Manifest scoped to `/command-center/future/`, icons exist, one maskable
- Auth contract (`tests/command-center/auth-contract.test.mjs`): `DASHBOARD_PASSWORD` only, trimmed; `SESSION_SIGNING_SECRET` required; `mya_session` cookie flags + 24h; 5/15/15 throttling; shared gate on every `command-center-*.ts`; login/logout the only pre-gate branches; secrets never in client code

- New invariant ("must never …") → add a guard
- Intentional change that trips a guard → update the guard in the same commit and say so in the commit message
