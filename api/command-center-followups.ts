import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to. This one
 * WRITES (creates a follow-up), so do not merge to main without Deployment
 * Protection covering Production too, or a proper page-level login.
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
    const { count, error } = await supabase
      .from("mya_followups")
      .select("id", { count: "exact", head: true })
      .eq("status", "open");

    if (error) {
      console.error("command-center-followups GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ openCount: count ?? 0 });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const dueAt = typeof body.dueAt === "string" && body.dueAt ? body.dueAt : null;

    if (!customerName) {
      return res.status(400).json({ error: "customerName is required" });
    }

    const { data, error } = await supabase
      .from("mya_followups")
      .insert({
        customer_name: customerName,
        note: note || null,
        due_at: dueAt,
        status: "open",
      })
      .select("id")
      .single();

    if (error) {
      console.error("command-center-followups POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, id: data?.id });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
