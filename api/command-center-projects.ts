import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to.
 * Read-only — projects are created/updated via Ask Mya's create_project/
 * update_project skills (command-center-ask-mya.ts); this just feeds the
 * dashboard's "Projects Needing Attention" panel.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { data, error } = await supabase
    .from("mya_projects")
    .select("id,project_name,client_name,status,next_action,outstanding_decisions,updated_at")
    .not("status", "in", "(completed,lost)")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (error) {
    console.error("command-center-projects GET error:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ projects: data || [] });
}
