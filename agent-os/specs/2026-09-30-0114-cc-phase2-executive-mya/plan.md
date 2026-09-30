# Command Center Phase 2: Executive Mya, Wired to Real Systems

## Context

Phase 1 (`8b6394e`) built the cockpit shell in `command-center/future/`: navigation, Home briefing, Chat+Voice, and the Projects/Approvals/Memory/Files/Operations/Devices/Systems modules. Every block shows Live, Stale or Not connected. What already works: seven existing `/api` sources, Chat and Voice through `command-center-ask-mya` (Anthropic plus the SKILLS tool loop), and approve/decline. Everything outside this repo (Hermes, Telegram, Hindsight, router, Windows agent, Houzz) is a static "Not connected" card in `MyaData.INTEGRATIONS`.

Phase 2 turns the shell into a working Executive Mya interface. It reaches external systems only through **narrow, server-side, read-only adapters**. It does not re-create those systems, and it keeps the current architecture and security boundaries.

**Shaping decisions**
- **Chat brain:** Anthropic plus SKILLS stays the default. The Hermes route is optional and off by default. It is text-only, and the server accepts it only when `HERMES_BRIDGE_KEY` is set.
- **Hindsight:** a direct server-side, read-only adapter, but only against a **verified** contract.
- **Health:** server-side probes in `command-center-data?type=systems`, using only **verified** signals.
- **Visuals:** none. Keep the Phase 1 design language.

**Your corrections (binding)**
1. Work on the new local branch `claude/cc-phase2-executive`, cut from `59e8c0d` before any change. No push, merge or deploy.
2. The protection baseline is `59e8c0d`, not `main`. At the end, `api/mya-*.ts` and `api/outbound-call.ts` must be byte-identical to that commit.
3. Hermes health:
   - Assume no endpoint exists, `/models` included.
   - Use only a read-only signal verified in existing code, docs or the runtime interface. Otherwise report `not_observable` or `not_configured`.
   - Never modify the Hermes runtime.
4. Hindsight:
   - Verify the paths, auth format, bank semantics and the health/recall/search operations from the installed config or authoritative docs before any network call.
   - If they can't be verified, ship the adapter contract and UI as Not configured / Not observable, with no guessed contract.
5. Hindsight is strictly read-only: no retain, write or delete. Its credential stays server-side only, and it never connects to Reception.
6. No changes to Production or Vercel secrets. `.env.example` gets placeholders only, and no real credentials go in the repo.
7. The MCP allowlist stays exactly `get_project`, `get_client` and `search_projects`.
8. The phone, Reception and ElevenLabs pipeline stays untouched. Hardening happens only in Command Center-owned code that has no effect on Reception. If a change could affect the phone pipeline, stop and report it.
9. The 12-function cap is a constraint, not a reason to restructure working APIs. That means no moving `getServicesStatus` or the `get_project` logic.
10. Keep the Phase 1 visual language: no redesign and no fake production data.

---

## Task 1: Branch and save spec documentation
- Run `git switch -c claude/cc-phase2-executive` from `59e8c0d`.
- Create `agent-os/specs/2026-09-30-0114-cc-phase2-executive-mya/` with:
  - **plan.md:** this plan.
  - **shape.md:** scope, decisions, corrections and product alignment.
  - **standards.md:** the full text of the 12 standards: `api/*` (4), `frontend/*` (4), `testing/*` (3) and `voice/reception-guardrails`.
  - **references.md:**
    - `future/*` shell.
    - `chat.js` voice pipeline.
    - MCP allowlist: `command-center-ask-mya.ts:1558-1610`.
    - Provider seam: `:1826-1862`.
    - `?type=` precedent: `command-center-projects.ts:115`.
    - `dev/preview-server.mjs`.
    - The Hermes and Hindsight verification findings, with each source.

## Task 2: Verify external contracts, then write narrow adapters in `lib/integrations/`
- **Verification first:**
  - Search the repo: the provider seam, MCP bridge, `.env.example`, desktop-app and the `claude/hermes-read-bridge` history.
  - Search any locally installed Hermes or Hindsight config and client docs.
  - Look for a documented read-only health/status signal and for Hindsight's recall/search contract.
  - Record the findings.
- **Shared rules:**
  - Read `process.env` per call.
  - Use a single `fetch` with an `AbortController` timeout of about 2.5s.
  - Return normalized shapes only, never upstream bodies or secrets, with generic error text.
  - Import no Vercel or Supabase code, so `node --test` (Node 26) can test the adapters directly.
- **`probe.ts`:** result shape is `{ id, status: up|down|not_configured|not_observable, latencyMs, checkedAt, detail }`.
- **`hermes.ts`:** `hermesHealth()` returns:
  - `not_configured` when there's no key.
  - `not_observable` when a key is set but no signal is verified.
  - A real probe only against a verified signal.
  - Telegram and router are `not_observable` unless Hermes verifiably reports them.
- **`hindsight.ts`:**
  - Contract: `hindsightHealth()` and `hindsightRecall(query, limit)`.
  - Network calls exist only for a verified contract; otherwise both return `not_configured` / `not_observable` without making a request.
  - No write, retain or delete function.
  - Clamp the query and cap the limit at 20.

## Task 3: Real system health, `GET /api/command-center-data?type=systems`
- The branch goes after the auth gate, follows the endpoint skeleton, returns `{ systems: [...] }` and uses `Promise.allSettled`.
- **Supabase, Anthropic, ElevenLabs, Twilio:** the existing config checks, plus a Supabase `select id limit 1` for a real "up".
- **Hermes, Telegram, router, Hindsight:** whatever the verified adapters report.
- **Hermes MCP bridge:** configured means enabled plus a key. Also show the last real call from `mya_action_log` where `requested_by = 'hermes_mcp'`.
- **Windows agent:** last activity from `mya_action_log` with the surface `desktop_app` (Task 7). Otherwise `not_observable`. No heartbeat.
- **Houzz:** Not connected.
- 500s get a generic message. `CORS *` is not widened.

## Task 4: Hindsight memory access (read-only)
- **Endpoint:** `GET /api/command-center-memory?type=hindsight&q=` goes after the auth gate. It returns `{ memories: [...] }`, or 503 `not_configured`. The existing facts GET/DELETE is unchanged.
- **SKILL:** add `recall_hindsight` to `SKILLS`. It is level 0 by prefix. It is **not** in `MCP_TOOL_ALIASES`.
- **Memory view:**
  - Hindsight search via a new `MyaData.query()`, so views still never call `fetch`.
  - The Hindsight card shows live status.
  - Sources are labeled: "Remembered in Command Center" vs "Hindsight".

## Task 5: Project data in depth
- **`?type=detail&id=`** returns one project plus its estimate items and upcoming schedule. It's implemented in the projects endpoint and mirrors the `get_project` query (with a comment saying so). The skill itself is untouched.
- **`?type=search&q=`** uses the same parameterized filter semantics as `list_projects`, capped.
- **UI:**
  - Row click opens a detail panel: a side panel on desktop, a sheet on mobile.
  - Search input.
  - "Ask Mya about this project."
  - The Houzz card stays Not connected.

## Task 6: Approvals
- **`GET ?status=recent`** returns the last 10 resolved approvals. Pending GET/POST and the 409 are unchanged.
- **UI:**
  - "Recently resolved" section.
  - Confirm step on mobile.
  - The badge updates on the strip, rail and tab bar.
- **`TOOL_SOURCES`:** add `update_company_brain: ["approvals"]`.

## Task 7: Chat/Voice
- **Runtime line:** the Mya view shows which runtime answered. Replies show tool chips from `toolsUsed`.
- **Honest errors:** 503 `not_configured`, a generic retry for 500, and `auth.expired` on 401.
- **Optional Hermes route:**
  - `provider: "hermes"` is accepted only when the key is set; otherwise 400.
  - The route makes no tool calls, and the response includes `provider`.
  - The UI toggle shows only when `systems` reports Hermes `up`. Unless a verified signal exists, it stays hidden.
- **Audit surface:** requests authenticated with the header log the surface as `desktop_app`. This is labeling only, using a `lib/session.ts` `authMethod(req)` helper that reuses the existing checks.
- **Hardening:** the MCP bearer compare (`command-center-ask-mya.ts:1671`) goes from `!==` to `safeStringEqual`. This is Command Center-owned code with no effect on Reception.
- **Unchanged:** the voice pipeline and the real Core states.

## Task 8: Frontend wiring (`future/`)
- **`data.js`:** add a `systems` source and `query()` for on-demand reads (Hindsight, project detail and search), with the same 401 handling and per-key freshness. `INTEGRATIONS` becomes descriptions only.
- **`lib.js`:**
  - `integrationStatus(system, freshness)`: if `systems` is stale or offline, the card is **never** "Connected".
  - `toolLabel`, `providerLabel`.
- **`views.js`:**
  - Real Systems table.
  - Integration cards driven by `systems`.
  - The strip shows the worst of freshness and critical health.
  - The briefing mentions Hermes being down only when that's known.
- **`index.html`:** new blocks in the Phase 1 visual language. Bump `?v=N` together with `SHELL_ASSETS` and `CACHE_VERSION` in `sw.js`. The SW still never touches `/api/`.

## Task 9: Preview server and tests
- **Preview fixtures:** synthetic fixtures behind the banner for systems, Hindsight, project detail/search and recent approvals. `unconnected` mode fails all of them.
- **Unit tests:**
  - `integrationStatus` rules.
  - `toolLabel` fallback.
  - An `integrations.test.mjs` adapter suite with stubbed `fetch` and a fixed clock, checking four rules:
    - A missing env var makes no request.
    - A timeout reports `down`.
    - The secret never appears in output.
    - Hindsight has no write export.
- **Guards:**
  - `api/` holds exactly 12 files.
  - The MCP aliases are exactly the 3 names.
  - Reception files don't import `lib/integrations` or mention Hindsight or Hermes.
  - `future/` doesn't reference `HINDSIGHT_`, `HERMES_BRIDGE_KEY` or `MCP_BRIDGE_KEY`.

## Task 10: Verify and commit locally
- **Tests:** `node --test tests/command-center/` passes.
- **Preview server:** run all 3 modes at desktop and phone widths and confirm:
  - No "Connected" appears in unconnected mode.
  - The login overlay appears in login mode.
  - Down and Not configured render honestly.
- **Real-handler check:** use a fake Supabase and stubbed upstreams, and confirm:
  - New branches return 401 without a session.
  - Probe timeouts are clean.
  - `recall_hindsight` works in chat (stubbed).
  - MCP `tools/list` still returns exactly 3 tools.
  - A wrong MCP key is still rejected.
- **Protection checks:** `git diff 59e8c0d -- api/mya-*.ts api/outbound-call.ts` is empty, and `ls api | wc -l` is 12.
- **`.env.example`:** placeholders only.
- **Commit:** local commit on `claude/cc-phase2-executive`. **No push, merge or deploy.** The report lists what's unverified and what you need to supply.

---

## Implementation notes (as built)

- **Adapters are one file:** `lib/integrations.ts`, not a `lib/integrations/` folder. A single file with no relative imports loads under both Vercel's TS build and `node --test`, where extensionless relative imports fail in ESM.
- **New `configured` status:** credentials are set, but the server did no live check, either because a check would cost money (Anthropic, ElevenLabs) or because no read-only endpoint exists. This keeps "configured" from being shown as "up".
- **Hermes:** no documented read-only health signal was found in the repo, the history, the local install (`~/.hermes` has skills only; the `hermes-agent` package isn't installed) or the docs. With a key it reports `not_observable`, and without one `not_configured`. It is never probed. The chat provider toggle is built but stays hidden until a live check reports Hermes `up`, which can't happen yet.
- **Hindsight:** verified against the Hindsight Cloud API reference (v0.10.1) and its cURL examples. The health check uses the read-only bank GET, and recall runs only on an explicit search or skill call, never from health checks because recall costs credits.
- **Project detail:** an inline card at the top of Projects on every screen size, instead of a side panel or sheet. This keeps the Phase 1 visual language.
- **`update_company_brain`:** no `TOOL_SOURCES` → approvals mapping. The skill writes `mya_company_brain` directly and never goes through `mya_approvals`, so the mapping would be wrong. This is reported as a gap against the "level 3+ must route through `mya_approvals`" standard and is **not** changed here.
- **Mobile approve/decline** confirms with the native `window.confirm`.
