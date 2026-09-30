import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { isCommandCenterAuthenticated } from "../lib/session";
import { hindsightRecall } from "../lib/integrations";

/**
 * Requires a valid dashboard session cookie or COMMAND_CENTER_API_KEY (see
 * isCommandCenterAuthenticated in lib/session.ts) -- checked before any
 * Supabase query or mutation runs. This one WRITES (deletes a memory), so an
 * unauthenticated request must never reach the database.
 *
 * Facts are added via Ask Mya's remember_fact skill (command-center-ask-mya.ts),
 * not here — this endpoint is read + delete only, for the dashboard's
 * Memory panel.
 *
 * GET ?type=hindsight&q=... searches Mya's long-term Hindsight memory
 * through the read-only adapter in lib/integrations.ts (server-side key,
 * never sent to the browser). No retain/write path exists here.
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

  if (!isCommandCenterAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method === "GET" && req.query.type === "hindsight") {
    const result = await hindsightRecall(req.query.q, req.query.limit);
    if (result.ok) return res.status(200).json({ memories: result.memories });
    if (result.reason === "invalid_query") return res.status(400).json({ error: "q is required" });
    if (result.reason === "not_configured") return res.status(503).json({ error: "not_configured" });
    console.error("command-center-memory GET hindsight error: recall unavailable");
    return res.status(502).json({ error: "Hindsight isn't reachable right now." });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_remembered_facts")
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
    const { error } = await supabase.from("mya_remembered_facts").delete().eq("id", id);
    if (error) {
      console.error("command-center-memory DELETE error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
