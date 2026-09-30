# Watch Mya + Computer Control (2026-09-30)

## What already existed (inventory, before building)
- **Windows Agent** = `desktop-app/mya_desktop.py` (Python tray app, Windows).
  - Hotkey → screenshot + mic → Claude vision *perception only* → the SAME `/api/command-center-ask-mya` (Executive Mya) with `x-command-center-key: COMMAND_CENTER_API_KEY`.
  - Click/type via pyautogui, only after a spoken "yes" (`handle_action_request`).
  - **Connection model: outbound HTTPS only.** No listening port, no heartbeat, no stream, no control channel.
- **Command Center**: Systems → "Windows agent" was `not_observable` (last `mya_action_log` row with surface `desktop_app`). Devices had a placeholder saying Pause / computer access "arrive later".
- **Browser / CDP**: nothing in this repo or any branch (`git grep` over all refs). If it exists, it lives in the Hermes runtime (VPS), which isn't inspectable from here.
- **Constraints**: `api/` is at the 12-function cap (so `?type=` branches); MCP is a read-only allowlist and must not widen; auth = signed session cookie (owner) or `COMMAND_CENTER_API_KEY` (agent) via `commandCenterAuthMethod`.

## What was built (reusing that model; no new agent, no open ports)
| Piece | Where |
|---|---|
| Control contract (mya / user / paused; only the owner grants, the agent only yields; Take control + Stop always accepted) | `lib/computer.ts`, `tests/command-center/computer.test.mjs` |
| API: `GET ?type=computer`, `GET ?type=computer-frame` (owner), `POST ?type=computer-control` (owner session only), `POST ?type=computer-report` (agent key only; response = whether it may issue input) | `api/command-center-data.ts` |
| Proposed tables (NOT applied) | `schema.sql` |
| Agent: `ControlGate` checked right before every pyautogui call; cursor moved by you → yields at once; outbound reporter (heartbeat ~1s, JPEG frame ~2s) — opt-in `MYA_WATCH=on` | `desktop-app/watch.py`, `test_watch.py`, `mya_desktop.py` |
| Watch Mya view, presence/Core wiring, yield-only voice words, screen context | `command-center/future/watch.js`, `lib.js`, `presence.js`, `core.js` |
| Synthetic fixture (real rules, stamped SYNTHETIC) | `dev/preview-server.mjs --mode=fixtures [--computer=active|offline|off]` |

## Authority
Computer control never raises Mya's permissions. A task that reaches a consequential step reports `status: "approval"` with the `mya_approvals` id; the view shows it and she doesn't pass it until you decide in Approvals. Voice can only take control *away* from her ("stop", "wait", "don't submit" → pause; "I'll take over" → take); giving it back is always a button.

## Integration boundary
1. **Next (single blocker):** apply `schema.sql` to the Supabase database behind a Preview deployment (owner approval). Until then every `?type=computer*` call answers 503 and the Command Center says "Not set up".
2. Then: push the branch for a Preview deploy; on the PC set `.env` `MYA_WATCH=on`, `COMMAND_CENTER_API_KEY` (same value as Vercel Preview), `DASHBOARD_BASE_URL` = the Preview URL; run `python mya_desktop.py`. Watch Mya then shows the real screen and Pause / Take control reach the PC within ~1s.
3. Still open (decisions, not code here): how Executive Mya *starts* computer tasks. Today the agent only acts on your hotkey. A Mya → agent task channel needs either a Hermes-side tool that talks to this API or a new MCP write tool (widening MCP — needs approval). Browser/CDP control should run on the PC inside the agent against `localhost` only, never exposed; the existing Hermes browser work (if any) needs to be located first.
