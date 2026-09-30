# Command Center Phase 2 — Executive Mya — Shaping Notes

## Scope

Turn the Phase 1 cockpit shell (`command-center/future/`) into a working Executive Mya interface. It connects the highest-value existing Mya capabilities and real system state, and keeps the current architecture and security boundaries. The priorities, in order:
1. Mya Chat and Voice.
2. Real system and integration health.
3. Approvals.
4. Existing project data.
5. Read access to memory backed by Hindsight.
6. Clear connected and not-connected states.

Desktop and mobile/PWA remain one product.

## Decisions

- **Chat:** Anthropic plus SKILLS stays the default, so tools, approvals and audit keep working. The Hermes route is optional and off by default: text only, accepted server-side only when `HERMES_BRIDGE_KEY` is set, and the UI toggle appears only when Hermes is verifiably up.
- **Hindsight:** a direct, server-side, **read-only** adapter against the *documented* API. No retain, write or delete. `recall_hindsight` becomes a level-0 skill and is **not** exposed over MCP.
- **Health:** server-side checks in `command-center-data?type=systems`. The statuses are `up`, `down`, `configured`, `not_configured` and `not_observable`. Only verified signals count, and there are no invented endpoints.
- **Visuals:** none. Keep the Phase 1 visual language.

## Constraints (owner corrections, binding)

1. Work on local branch `claude/cc-phase2-executive`, cut from `59e8c0d`. No push, merge or deploy.
2. The protection baseline is `59e8c0d`: `api/mya-*.ts` and `api/outbound-call.ts` must stay byte-identical to it.
3. Hermes gets no assumed health endpoint, `/models` included. Use a verified signal or report `not_observable`/`not_configured`. Never modify Hermes.
4. Hindsight's contract must be verified from docs or the installed config before any network call. If it can't be verified, ship the contract and show Not configured.
5. Hindsight is strictly read-only, with the credential server-side only, and never connected to Reception.
6. No Production or Vercel secret changes. `.env.example` gets placeholders only.
7. The MCP allowlist stays exactly `get_project`, `get_client` and `search_projects`.
8. The phone, Reception and ElevenLabs pipeline stays untouched. Hardening happens only in code the Command Center owns.
9. The 12-function cap is a constraint, not a reason to restructure working APIs.
10. No redesign and no fake production data.

## Context

- **Visuals:** none.
- **References:** see `references.md`.
- **Product alignment:** this follows the Command Center direction: an executive cockpit, not a CRM, and one Mya across Telegram, the Command Center, voice and desktop. Houzz stays the system of record, with Mya orchestrating above it. Sample data is never shown as live, consequential actions need approval, and secrets stay server-side.

## Standards Applied

- **api/endpoint-skeleton:** every new `?type=`/`?status=` branch sits after the auth gate, returns named collections, and returns generic 500s.
- **api/function-cap:** no new `api/` files. New work goes in branches, a skill and `lib/`.
- **api/mya-skills-permissions:** `recall_hindsight` is level 0 by its prefix and is excluded from MCP.
- **api/secrets-and-session:** a single auth gate, the timing-safe MCP key compare, and no secrets in browser code or responses.
- **frontend/auth-and-service-worker:** unchanged. The SW still never touches `/api/`, and the cache is bumped to v14.
- **frontend/data-honesty:** a stale Systems check never shows "Connected", and dead controls are hidden.
- **frontend/module-data-flow:** ES5 IIFEs, and `MyaData.query()` so views never call `fetch` themselves.
- **frontend/mya-core-and-dev-states:** `core.css` is untouched, and only real Core states are used.
- **testing/preview-server:** Phase 2 fixtures sit behind the SYNTHETIC banner, with a `--hindsight=down` option.
- **testing/static-guards:** new guards for the function cap, the MCP allowlist, the Reception baseline and browser secrets.
- **testing/test-style:** `node:test`, a fixed clock, and injected `fetch`/`env`.
- **voice/reception-guardrails:** Reception files are untouched and guarded against the baseline.
