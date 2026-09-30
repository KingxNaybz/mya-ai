# Mya Core & Dev States

- Exactly one Core element; `MyaShell.placeCore()` moves it between `.core-slot`s. Never clone it
- Change state only via `MyaCore.setState/setTemporary` (keeps labels + aria in sync)
- Real states: idle, listening, thinking, speaking, plus:
  - awaiting-approval: the resting state MyaPresence sets via `MyaCore.setResting()` while real approvals are pending
  - error: a brief flash on a failed request (`mya.outcome` with `ok: false`)
- All other states are dev-only
- Every state change emits `core.state` (`detail.dev` for dev previews, which presence ignores)
- Dev-only UI lives behind `?dev=1`; dev emissions set `detail.dev = true` and never hit the network
- `core.css` is tuned; change it only deliberately, updating the byte-identical baseline in `tests/command-center/shell.test.mjs` in the same change
- Prefer refining a state from `styles.css` with a `.core-slot`-prefixed override (it outranks `core.css`, which loads later), as the resting approval Core does
