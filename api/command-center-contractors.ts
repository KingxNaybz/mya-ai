import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to. This one
 * WRITES (adds/removes contractors), so do not merge to main without
 * Deployment Protection covering Production too, or a proper page-level
 * login in front of the Command Center.
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

const COLUMNS = "id,category,name,phone,pricing_rate,notes,added_in_crm";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_contractors")
      .select(COLUMNS)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("command-center-contractors GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ contractors: data || [] });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    const pricingRate = typeof body.pricingRate === "string" ? body.pricingRate.trim() : "";
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    const addedInCrm = Boolean(body.addedInCrm);

    if (!category || !name) {
      return res.status(400).json({ error: "category and name are required" });
    }

    const { data, error } = await supabase
      .from("mya_contractors")
      .insert({
        category,
        name,
        phone: phone || null,
        pricing_rate: pricingRate || null,
        notes: notes || null,
        added_in_crm: addedInCrm,
      })
      .select(COLUMNS)
      .single();

    if (error) {
      console.error("command-center-contractors POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, contractor: data });
  }

  if (req.method === "DELETE") {
    const id = typeof req.query.id === "string" ? req.query.id : (req.body || {}).id;
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }

    const { error } = await supabase.from("mya_contractors").delete().eq("id", id);

    if (error) {
      console.error("command-center-contractors DELETE error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
