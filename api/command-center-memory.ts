import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to. This one
 * WRITES (deletes a memory), so do not merge to main without Deployment
 * Protection covering Production too, or a proper page-level login.
 *
 * Facts are added via Ask Mya's remember_fact skill (command-center-ask-mya.ts),
 * not here — this endpoint is read + delete only, for the dashboard's
 * Memory panel.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_memory")
      .select("id,fact,created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("command-center-memory GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ facts: data || [] });
  }

  if (req.method === "DELETE") {
    const id = typeof req.query.id === "string" ? req.query.id : (req.body || {}).id;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    const { error } = await supabase.from("mya_memory").delete().eq("id", id);
    if (error) {
      console.error("command-center-memory DELETE error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
