# Mya Core & Dev States

- Exactly one Core element; `MyaShell.placeCore()` moves it between `.core-slot`s. Never clone it
- Change state only via `MyaCore.setState/setTemporary` (keeps labels + aria in sync)
- Real states: idle, listening, thinking, plus:
  - waiting: a request still in flight after `MyaLib.WAITING_AFTER_MS` (`mya.waiting`)
  - speaking: only while her reply audio is actually playing (never for a text-only reply)
  - completed: a brief settle when a reply arrives without audio, or when she finishes speaking
  - awaiting-approval / blocked: resting states MyaPresence sets via `MyaCore.setResting()` while real approvals are pending / Executive Mya is unreachable
  - error: a brief flash on a failed request (`mya.outcome` with `ok: false`)
- Dev-only (no backend signal yet): working, memory-retrieval, tool-use, delegating, alert
- Voice level: `--voice-level` (0..1, on `<html>`) plus `.has-level` on the Core drives speaking/listening from her real audio or the recognizer's results. Attach the Web Audio analyser only when the AudioContext is already running (a suspended one silences playback)
- Small hosts show the Core echo (`.core-echo`, static SVG colored by `html[data-mya-state]`) when the Core is elsewhere. It's an emblem, not a second Core
- Every state change emits `core.state` (`detail.dev` for dev previews, which presence ignores)
- Dev-only UI lives behind `?dev=1`; dev emissions set `detail.dev = true` and never hit the network
- `core.css` is tuned; change it only deliberately, updating the byte-identical baseline in `tests/command-center/shell.test.mjs` in the same change
- Prefer refining a state from `styles.css` with a `.core-slot`-prefixed override (it outranks `core.css`, which loads later), as the resting approval Core does
