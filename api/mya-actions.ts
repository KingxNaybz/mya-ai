import type { VercelRequest, VercelResponse } from "@vercel/node";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers["x-cron-secret"] || req.query?.secret;
    if (!CRON_SECRET || auth !== CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
      const headers: Record<string, string> = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
        try {
            if (req.method === "GET") {
                  const url = SUPABASE_URL + "/rest/v1/mya_actions?status=eq.pending&order=created_at.asc&limit=" + (req.query?.limit || "10");
                        const r = await fetch(url, { headers });
                              if (!r.ok) return res.status(r.status).json({ error: await r.text() });
                                    return res.status(200).json(await r.json());
                                        }
                                            if (req.method === "PATCH") {
                                                  const body = req.body || {};
                                                        if (!body.id || !body.status) return res.status(400).json({ error: "id and status required" });
                                                              const update: Record<string, any> = { status: body.status, updated_at: new Date().toISOString() };
                                                                    if (body.status === "sent" || body.status === "failed") update.executed_at = new Date().toISOString();
                                                                          if (body.error) update.error = body.error;
                                                                                const r = await fetch(SUPABASE_URL + "/rest/v1/mya_actions?id=eq." + body.id, { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(update) });
                                                                                      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
                                                                                            return res.status(200).json(await r.json());
                                                                                                }
                                                                                                    return res.status(405).json({ error: "Method not allowed" });
                                                                                                      } catch (err: any) { return res.status(500).json({ error: String(err?.message || err) }); }
                                                                                                      }