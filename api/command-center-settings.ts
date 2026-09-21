import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to. Do not
 * merge to main without Deployment Protection covering Production too, or
 * a proper page-level login in front of the Command Center.
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

const SETTINGS_COLUMNS = "owner_name,footer_tagline,notify_enabled,notify_phone";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_settings")
      .select(SETTINGS_COLUMNS)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("command-center-settings GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ settings: data || null });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.ownerName === "string") update.owner_name = body.ownerName.trim().slice(0, 60);
    if (typeof body.footerTagline === "string") update.footer_tagline = body.footerTagline.trim().slice(0, 140);
    if (typeof body.notifyEnabled === "boolean") update.notify_enabled = body.notifyEnabled;
    if (typeof body.notifyPhone === "string") update.notify_phone = body.notifyPhone.trim().slice(0, 20) || null;

    const { data, error } = await supabase
      .from("mya_settings")
      .update(update)
      .eq("id", 1)
      .select(SETTINGS_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error("command-center-settings POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, settings: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
