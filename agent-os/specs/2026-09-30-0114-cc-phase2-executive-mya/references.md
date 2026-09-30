# References for Command Center Phase 2 — Executive Mya

## Similar Implementations

### Phase 1 cockpit shell
- **Location:** `command-center/future/`: `data.js`, `views.js`, `lib.js`, `shell.js`, `chat.js`.
- **Relevance:** Phase 2 extends it in place.
- **Key patterns:**
  - `MyaData` sources plus freshness.
  - `MyaLib.computeFreshness`.
  - `stateBlock()` for anything unknown.
  - `data.changed` re-rendering.

### Build 10–12 voice pipeline
- **Location:** `command-center/future/chat.js`.
- **Relevance:** Chat and Voice must keep working behavior-for-behavior.
- **Key patterns:** the single `performSend()` path, and `MyaData.refreshForTools(toolsUsed)`.

### MCP allowlist
- **Location:** `api/command-center-ask-mya.ts` (`MCP_TOOL_ALIASES`, `handleMcpRequest`).
- **Relevance:** it must not widen. Phase 2 hardens the bearer compare to `safeStringEqual`.

### Provider seam
- **Location:** `api/command-center-ask-mya.ts` (`callModel`, `callHermes`).
- **Relevance:** the optional Hermes route reuses it unchanged.

### `?type=` branching
- **Location:** `api/command-center-projects.ts` (`?type=alerts`).
- **Relevance:** it's the precedent for adding capability without new functions under the 12-function cap.

### Preview server
- **Location:** `dev/preview-server.mjs`.
- **Relevance:** synthetic fixtures live only in the server, behind the banner.

## External contract verification (2026-09-30)

### Hermes runtime — no health signal found
- **Repo:** the only Hermes interface is `POST {HERMES_BRIDGE_URL}/chat/completions` with Bearer auth in `callHermes`. That's a paid model call, not a health check. The `claude/hermes-read-bridge` history adds only the inbound MCP bridge.
- **Local machine:** `~/.hermes` holds skills only. `~/.local/bin/hermes` is a launcher stub for `pipx:hermes-agent`, which isn't installed, so there's no local source or config to inspect.
- **Production path:** Open WebUI → Cloudflare → Hermes, via the multiplex at `/p/mya/v1`. It's custom, and no documented read-only status route exists.
- **Result:** a configured key reports `not_observable`; no key reports `not_configured`. Telegram and the router are `not_observable`.

### Hindsight — verified from official docs
- **Sources:**
  - Hindsight Cloud API reference v0.10.1: https://docs.hindsight.vectorize.io/api-reference/hindsight-cloud-api
  - cURL examples: https://docs.hindsight.vectorize.io/curl-examples
  - TypeScript SDK guide: https://docs.hindsight.vectorize.io/typescript-sdk
- **Auth:** `Authorization: Bearer <key>`. Keys start with `hsk_`.
- **Bank:** `GET /v1/default/banks/{bank_id}`. It's a read-only lookup, used as the health check.
- **Recall:** `POST /v1/default/banks/{bank_id}/memories/recall` with the body `{ "query": "..." }`. The response is `{ results: [{ id, text, type, entities }], ... }`. It uses recall credits, so it runs only on explicit search.
- **`bank_id`:** a user-chosen identifier for one memory space, such as the bank Mya's Hermes runtime retains into.
- **Hermes integration:** the Hindsight plugin for hermes-agent uses `HINDSIGHT_API_URL`, `HINDSIGHT_API_KEY` and `HINDSIGHT_BANK_ID` (cloud, local_embedded and local_external modes). The Command Center uses the same variable names.
- **Not verified:** which mode and bank the owner's Hermes actually uses, and whether a scoped read-only key exists. The owner supplies these as env vars.

### Hermes chat endpoint identity: NOT verified (2026-09-30, second pass)
- **Claim:** `https://mya-api.gaelevate.com/p/mya/v1` is "Open WebUI → Cloudflare → Hermes → the `mya` profile".
- **Source of the claim:** only a code comment and the message of commit `9c2b9f0` (2026-09-24, an earlier cloud session), which calls it "externally verified" but records no evidence.
- **Searched with no corroboration:** every local branch and `origin/*` ref, `.env.example`, the agent-os specs, `~/.hermes` (skills only), and the `~/.local/bin/hermes` launcher stub (hermes-agent isn't installed locally).
- **Not established:** that the `mya` model on this endpoint is the same Hermes profile Telegram uses, and that requests through it get her Hermes tools and Hindsight. Only the VPS/Open WebUI config can settle this, and it wasn't touched.
