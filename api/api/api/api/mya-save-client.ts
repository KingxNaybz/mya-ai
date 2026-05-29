import type { VercelRequest, VercelResponse } from "@vercel/node";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const SECRET = process.env.PROXY_SECRET || process.env.MYA_PROXY_SECRET || "";
async function supaFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { apikey:SUPABASE_KEY, Authorization:`Bearer ${SUPABASE_KEY}`, "Content-Type":"application/json", Prefer:"return=representation", ...(opts.headers||{}) } });
  }
  export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader("Access-Control-Allow-Origin","*");
      if (req.method==="OPTIONS") return res.status(200).end();
        if (req.method!=="POST") return res.status(405).json({ error:"Method not allowed" });
          const provided = req.headers["x-secret"]||req.headers["x-proxy-secret"];
            if (SECRET && provided!==SECRET) return res.status(401).json({ error:"Unauthorized" });
              try {
                  const { client:c, conversation:v } = req.body;
                      if (!c?.phone) return res.status(400).json({ error:"client.phone required" });
                          let contactId: string;
                              const ex = await supaFetch(`mya_contacts?phone=eq.${encodeURIComponent(c.phone)}&limit=1`);
                                  const existing = ex.ok ? await ex.json() : [];
                                      if (existing.length>0) {
                                            contactId = existing[0].id;
                                                  const upd: Record<string,any> = { total_calls:(existing[0].total_calls||0)+1, last_contact_at:new Date().toISOString(), updated_at:new Date().toISOString() };
                                                        for (const [k,val] of Object.entries(c)) { if (val!=null && val!=="" && k!=="phone") upd[k]=val; }
                                                              await supaFetch(`mya_contacts?id=eq.${contactId}`,{method:"PATCH",body:JSON.stringify(upd)});
                                                                  } else {
                                                                        const cr = await supaFetch("mya_contacts",{method:"POST",body:JSON.stringify({...c,total_calls:1,last_contact_at:new Date().toISOString(),created_at:new Date().toISOString()})});
                                                                              if (!cr.ok) return res.status(500).json({ error:await cr.text() });
                                                                                    contactId = (await cr.json())[0]?.id;
                                                                                        }
                                                                                            if (v?.conversation_id) {
                                                                                                  const ce = await supaFetch(`mya_conversations?conversation_id=eq.${v.conversation_id}&limit=1`);
                                                                                                        if (ce.ok && (await ce.json()).length===0) await supaFetch("mya_conversations",{method:"POST",body:JSON.stringify({...v,contact_id:contactId})});
                                                                                                            }
                                                                                                                return res.status(200).json({ success:true, contact_id:contactId });
                                                                                                                  } catch (err:any) { return res.status(500).json({ error:err.message }); }
                                                                                                                  }