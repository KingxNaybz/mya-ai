# Standards for Command Center Phase 2 — Executive Mya

The following standards apply to this work.

---

## api/endpoint-skeleton


Order is fixed: CORS/OPTIONS → auth gate → method branches → 405.

```ts
if (req.method === "OPTIONS") return res.status(200).end();
if (!isCommandCenterAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
if (req.method === "GET") { ... return res.status(200).json({ approvals: data || [] }); }
if (req.method === "POST") { ... return res.status(200).json({ ok: true, id }); }
return res.status(405).json({ error: "Method not allowed" });
```

- Auth runs before ANY Supabase read/write (only exception: settings login/logout branches)
- Errors: `{ error }` with 400 validation, 401, 405, 409 already-resolved, 500
- GET returns a named collection (`{ facts: [] }`), never a bare array
- Page limits (`.limit(10)`) are part of the contract — frontend shows "N+"; keep them in sync
- Idempotent writes: guard updates (`.eq("status", "pending")`) → 409 on repeat
- 500s: `console.error("<file> <METHOD> error:", error)`; new code returns a generic message, not raw `error.message`
- CORS `*` is legacy — don't widen it or copy it into new surfaces

---

## api/function-cap


`api/` is at the Hobby plan limit (12 files). Never add a new file under `api/`.

- New capability → first a `?type=` branch on the closest existing endpoint (e.g. `command-center-projects?type=alerts`)
- Mya capability → a `SKILLS` entry in `command-center-ask-mya.ts`
- Shared helpers go in `lib/` (not counted); small helpers may be duplicated with a comment saying why (e.g. `getServicesStatus`)

---

## api/mya-skills-permissions


`SKILLS` is the single source of truth — tool list, dispatcher, and `list_capabilities` derive from it. Add a capability = add one entry.

- Level by name: `get_` `list_` `calculate_` `evaluate_` `recall_` → 0 (read); everything else → 2
- Doesn't fit the default? Add to `PERMISSION_OVERRIDES` (e.g. `update_company_brain: 3`)
- Reversible writes call `logUndo(...)`; level 3+ must route through `mya_approvals`
- Every tool call → `logActionEvent` (best-effort, never blocks the reply)
- New write skill → add its name → sources to `TOOL_SOURCES` in `future/data.js`
- MCP (Hermes) exposes only level-0 skills in `MCP_TOOL_ALIASES`, re-checked at call time. Never expose writes

---

## api/secrets-and-session


Fail closed everywhere. Vercel Deployment Protection is NOT auth — never rely on it.

- Only gate: `isCommandCenterAuthenticated(req)` (session cookie OR `x-command-center-key`). Don't add a second mechanism
- `SESSION_SIGNING_SECRET` and `DASHBOARD_PASSWORD` are independent — never derive, fall back, or reuse one for the other
- Missing secret → token can't verify → deny (never "allow if unset")
- Compare secrets with `safeStringEqual` (timing-safe), never `===`
- Cookie: `HttpOnly; Secure; SameSite=Strict`, 24h TTL
- `lib/` reads `process.env` per call, not in module-level consts
- Login rate-limit store unreadable/unwritable → reject the attempt
- Never log or store submitted passwords or keys

---

## frontend/auth-and-service-worker


Fail closed. Reuse the existing session; never add a second auth mechanism.

- On load, probe `GET /api/command-center-settings` before rendering or fetching anything else
- Probe 401 / error / unreachable → login overlay, nothing else
- Any later 401 (poll, chat, approval) → emit `auth.expired` → overlay + `MyaData.stop()`
- After login/logout: `location.replace("/command-center/future/index.html")`, never `reload()`
- Register SW only after a confirmed session

Service worker = app shell only:
- Never intercept or cache `/api/` — no exceptions, ever (test-enforced)
- Same-origin GETs inside scope only; network-first, cache is fallback

---

## frontend/data-honesty


Nothing renders as real unless a fetch for it succeeded.

- Every data block shows freshness via `MyaLib.computeFreshness`:
  `live` | `stale` (old or last refresh failed) | `offline` ("Not connected") | `loading`
- Never show `0`, sample rows, or placeholders for unknown data. Unknown = `—` + freshness tag, or `stateBlock()`
- Stale keeps last-known data, tagged Stale — don't clear it
- `null`/`undefined` = "we don't know": omit from briefings/summaries, never zero it
- Capped source (page limit hit) → say "at least N" / "N+", never an exact count
- No backend yet:
  - Integrations → explicit "Not connected" card (`MyaData.INTEGRATIONS`), no dead controls
  - Metrics → omit until a real source exists
- Never load `sample-data.js` / `SAMPLE_DATA` in `future/` (test-enforced)
- All external text (DB, calls, chat) → `MyaLib.escapeHtml` before markup

---

## frontend/module-data-flow


No build step (Phase 1; may move to a framework later).

- Each file = ES5 IIFE exposing one `window.Mya*` global. No `import`, `const`/`let`, arrows, or bundler
- Load order (index.html): lib → mya-events → core → data → chat → views → shell → app
- `lib.js`: pure, DOM/network-free, UMD. Put decision logic here; test in `tests/command-center/` (`node --test`)
- Views never `fetch()`. Add a source to `MyaData.SOURCES` (existing `/api/*` endpoint), read via `MyaData.get/freshness`, re-render on `MyaEvents` `"data.changed"`
- After Mya tool calls, map tool → sources in `TOOL_SOURCES`
- Cross-module signals go through `MyaEvents` (namespaced: `mya.*`, `data.*`, `auth.*`, `chat.*`)
- Changing any shell asset: bump `?v=N` in index.html AND `SHELL_ASSETS` + `CACHE_VERSION` in sw.js together

---

## frontend/mya-core-and-dev-states


- Exactly one Core element; `MyaShell.placeCore()` moves it between `.core-slot`s. Never clone it
- Change state only via `MyaCore.setState/setTemporary` (keeps labels + aria in sync)
- Real states: idle, listening, thinking, speaking. All others are dev-only
- Dev-only UI lives behind `?dev=1`; dev emissions set `detail.dev = true` and never hit the network
- `core.css` is tuned; change it only deliberately, updating the byte-identical baseline in `tests/command-center/shell.test.mjs` in the same change

---

## testing/preview-server


`node dev/preview-server.mjs [--mode=unconnected|fixtures|login]` → http://127.0.0.1:4173/command-center/future/index.html

- Binds 127.0.0.1 only; reads no env vars; never calls Production or real APIs
- Modes: `unconnected` (default, every source fails), `fixtures` (synthetic), `login` (all 401)
- Fixture data lives ONLY in the server and is served with the "SYNTHETIC FIXTURE DATA — NOT REAL" banner. Product code never gets a fixture path
- Doesn't emulate real login — auth is decided only by the real `/api/command-center-settings`

---

## testing/static-guards


Encode hard invariants as source-scanning tests in `tests/command-center/shell.test.mjs`.

Current guards:
- `future/` never references `sample-data.js` / `SAMPLE_DATA`
- `sw.js` never handles `/api/`
- Every `MyaData.SOURCES` URL maps to an existing `api/*.ts`
- `core.css` byte-identical to its git baseline
- Manifest scoped to `/command-center/future/`, icons exist, one maskable

- New invariant ("must never …") → add a guard
- Intentional change that trips a guard → update the guard in the same commit and say so in the commit message

---

## testing/test-style


- `node:test` + `node:assert/strict` only — no frameworks, no new deps
- Run: `node --test tests/command-center/`
- Files: `tests/<area>/*.test.mjs` (ESM); load UMD modules via `createRequire`
- Unit-test pure logic in `command-center/future/lib.js`; move logic there to make it testable rather than testing the DOM
- Use a fixed clock (`const NOW = Date.UTC(...)`) and pass `now` in — never rely on `Date.now()`
- Test names state the rule in plain words ("never loaded is Not connected, never live")

---

## voice/reception-guardrails


Customer-facing phone Mya. Changes here need explicit owner approval — no exceptions.

- Reception Mya never reads or returns Executive/Command Center data (approvals, memory, company brain, action log)
- Don't import Command Center code into these files, or reception code into `command-center-*.ts`
- Webhook auth target (new or changed webhooks): verify a signature or shared secret, header only, `safeStringEqual`
- Known debt (fix only with approval):
  - `mya-call-start`, `mya-call-ended`, `outbound-call` accept unauthenticated POSTs
  - `mya-actions` compares `CRON_SECRET` with `!==` and accepts `?secret=`; falls back to `SUPABASE_ANON_KEY`
