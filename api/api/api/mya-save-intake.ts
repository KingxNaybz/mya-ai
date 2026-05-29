import type { VercelRequest, VercelResponse } from "@vercel/node";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
        const i = req.body || {};
            if (!SUPABASE_KEY) return res.status(500).json({ error: "No DB connection" });
                const r = await fetch(`${SUPABASE_URL}/rest/v1/mya_intakes`, {
                      method: "POST",
                            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
                                  body: JSON.stringify({ full_name:i.full_name||null, phone:i.phone||null, email:i.email||null, property_address:i.property_address||null, city:i.city||null, state:i.state||null, zip:i.zip||null, company_name:i.company_name||null, project_type:i.project_type||null, project_scale:i.project_scale||null, motivation:i.motivation||null, project_description:i.project_description||null, timeline:i.timeline||null, budget_range:i.budget_range||null, decision_makers:i.decision_makers||null, contractor_history:i.contractor_history||null, lead_source:i.lead_source||null, call_disposition:i.call_disposition||null, follow_up_date:i.follow_up_date||null, notes:i.notes||null, red_flags:i.red_flags||null, status:i.status||"new", qualified_by:"mya", created_at:new Date().toISOString() }),
                                      });
                                          if (!r.ok) return res.status(r.status).json({ error: await r.text() });
                                              const data = await r.json();
                                                  return res.status(200).json({ success: true, intake: data?.[0] || data });
                                                    } catch (err: any) { return res.status(500).json({ error: String(err) }); }
                                                    }