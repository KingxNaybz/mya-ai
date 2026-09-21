import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as command-center-data.ts: no password/key check of
 * its own — relies entirely on Vercel's own "Deployment Protection" for the
 * environment this is deployed to. Unlike that endpoint, this one WRITES
 * (resolves an approval), so it's more consequential to leave unprotected.
 * Do not merge to main without Deployment Protection covering Production
 * too, or a proper page-level login in front of the Command Center.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_approvals")
      .select("id,title,detail,status,requested_at")
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("command-center-approvals GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ approvals: data || [] });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const id = body.id;
    const action = body.action;

    if (!id || (action !== "approve" && action !== "decline")) {
      return res.status(400).json({ error: "id and action ('approve'|'decline') are required" });
    }

    // The .eq("status", "pending") guard means this only succeeds once —
    // a second click (e.g. a double-submit) can't flip an already-resolved
    // row again.
    const { data, error } = await supabase
      .from("mya_approvals")
      .update({
        status: action === "approve" ? "approved" : "declined",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id,status")
      .maybeSingle();

    if (error) {
      console.error("command-center-approvals POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(409).json({ error: "Already resolved or not found" });
    }
    return res.status(200).json({ ok: true, id: data.id, status: data.status });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
