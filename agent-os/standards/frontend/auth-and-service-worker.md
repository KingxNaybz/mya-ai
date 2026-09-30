# Auth & Service Worker (command-center/future/)

Fail closed. Reuse the existing session; never add a second auth mechanism.

- On load, probe `GET /api/command-center-settings` before rendering or fetching anything else
- Probe 401 / error / unreachable → login overlay, nothing else
- Any later 401 (poll, chat, approval) → emit `auth.expired` → overlay + `MyaData.stop()`
- After login/logout: `location.replace("/command-center/future/index.html")`, never `reload()`
- Register SW only after a confirmed session

Service worker = app shell only:
- Never intercept or cache `/api/` — no exceptions, ever (test-enforced)
- Same-origin GETs inside scope only; network-first, cache is fallback
