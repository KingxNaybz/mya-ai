# Local Preview Server (dev/preview-server.mjs)

`node dev/preview-server.mjs [--mode=unconnected|fixtures|login]` → http://127.0.0.1:4173/command-center/future/index.html

- Binds 127.0.0.1 only; reads no env vars; never calls Production or real APIs
- Modes: `unconnected` (default, every source fails), `fixtures` (synthetic), `login` (all 401)
- Fixture data lives ONLY in the server and is served with the "SYNTHETIC FIXTURE DATA — NOT REAL" banner. Product code never gets a fixture path
- Doesn't emulate real login — auth is decided only by the real `/api/command-center-settings`
