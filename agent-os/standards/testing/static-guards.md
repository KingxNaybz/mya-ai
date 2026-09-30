# Static Guard Tests

Encode hard invariants as source-scanning tests in `tests/command-center/shell.test.mjs`.

Current guards:
- `future/` never references `sample-data.js` / `SAMPLE_DATA`
- `sw.js` never handles `/api/`
- Every `MyaData.SOURCES` URL maps to an existing `api/*.ts`
- `core.css` byte-identical to its git baseline
- Manifest scoped to `/command-center/future/`, icons exist, one maskable

- New invariant ("must never …") → add a guard
- Intentional change that trips a guard → update the guard in the same commit and say so in the commit message
