# Mya Core & Dev States

- Exactly one Core element; `MyaShell.placeCore()` moves it between `.core-slot`s. Never clone it
- Change state only via `MyaCore.setState/setTemporary` (keeps labels + aria in sync)
- Real states: idle, listening, thinking, speaking. All others are dev-only
- Dev-only UI lives behind `?dev=1`; dev emissions set `detail.dev = true` and never hit the network
- `core.css` is tuned; change it only deliberately, updating the byte-identical baseline in `tests/command-center/shell.test.mjs` in the same change
