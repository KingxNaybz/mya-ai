# Endpoint Skeleton (api/command-center-*.ts)

Order is fixed: CORS/OPTIONS → auth gate → method branches → 405.

```ts
if (req.method === "OPTIONS") return res.status(200).end();
if (!isCommandCenterAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
if (req.method === "GET") { ... return res.status(200).json({ approvals: data || [] }); }
if (req.method === "POST") { ... return res.status(200).json({ ok: true, id }); }
return res.status(405).json({ error: "Method not allowed" });
```

- Auth runs before ANY Supabase read/write (only exception: settings login/logout branches)
- Errors: `{ error }` with 400 validation, 401, 405, 409 already-resolved, 500
- GET returns a named collection (`{ facts: [] }`), never a bare array
- Page limits (`.limit(10)`) are part of the contract — frontend shows "N+"; keep them in sync
- Idempotent writes: guard updates (`.eq("status", "pending")`) → 409 on repeat
- 500s: `console.error("<file> <METHOD> error:", error)`; new code returns a generic message, not raw `error.message`
- CORS `*` is legacy — don't widen it or copy it into new surfaces
