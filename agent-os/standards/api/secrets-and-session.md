# Secrets & Session (lib/session.ts)

Fail closed everywhere. Vercel Deployment Protection is NOT auth — never rely on it.

- Only gate: `isCommandCenterAuthenticated(req)` (session cookie OR `x-command-center-key`). Don't add a second mechanism
- `SESSION_SIGNING_SECRET` and `DASHBOARD_PASSWORD` are independent — never derive, fall back, or reuse one for the other
- Missing secret → token can't verify → deny (never "allow if unset")
- Compare secrets with `safeStringEqual` (timing-safe), never `===`
- Cookie: `HttpOnly; Secure; SameSite=Strict`, 24h TTL
- `lib/` reads `process.env` per call, not in module-level consts
- Login rate-limit store unreadable/unwritable → reject the attempt
- Never log or store submitted passwords or keys
