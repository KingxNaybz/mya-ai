# Local Preview Server (dev/preview-server.mjs)

`node dev/preview-server.mjs [--mode=unconnected|fixtures|login]` → http://127.0.0.1:4173/command-center/future/index.html

- Binds 127.0.0.1 only; reads no env vars; never calls Production or real APIs
- Modes: `unconnected` (default, every source fails), `fixtures` (synthetic), `login` (all 401)
- Fixture data lives ONLY in the server and is served with the "SYNTHETIC FIXTURE DATA — NOT REAL" banner. Product code never gets a fixture path
- Doesn't emulate real login — auth is decided only by the real `/api/command-center-settings`
- `fixtures` never expires: it has no sessions and never returns 401. A server-injected keepalive (`/__preview/ping`) hides the Production login overlay and shows a "Local preview server stopped" screen when the server is unreachable, then reloads when it answers again. Fixtures-only; product auth code is untouched
- Run it in your own terminal for long reviews. A server started as a background job can be stopped by that job's timeout
