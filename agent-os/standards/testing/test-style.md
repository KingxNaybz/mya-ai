# Test Style (tests/)

- `node:test` + `node:assert/strict` only — no frameworks, no new deps
- Run: `node --test tests/command-center/`
- Files: `tests/<area>/*.test.mjs` (ESM); load UMD modules via `createRequire`
- Unit-test pure logic in `command-center/future/lib.js`; move logic there to make it testable rather than testing the DOM
- Use a fixed clock (`const NOW = Date.UTC(...)`) and pass `now` in — never rely on `Date.now()`
- Test names state the rule in plain words ("never loaded is Not connected, never live")
