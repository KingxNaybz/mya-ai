import type { VercelRequest, VercelResponse } from "@vercel/node";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || "+16782440023";
const MICHAEL_PHONE = process.env.MICHAEL_PHONE || "";
async function sendSms(to: string, body: string) {
  if (!TWILIO_SID||!TWILIO_TOKEN||!to) return;
    const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,{method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:TWILIO_FROM,Body:body}).toString()});
      }
      async function insertNotif(payload: Record<string,unknown>) {
        if (!SUPABASE_URL||!SUPABASE_KEY) return;
          await fetch(`${SUPABASE_URL}/rest/v1/mya_notifications`,{method:"POST",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(payload)});
          }
          function phoneVariants(p: string) {
            const d=p.replace(/\D/g,""); const v=new Set([p]);
              if(d.length===10){v.add(d);v.add("+1"+d);v.add("1"+d);}
                if(d.length===11&&d[0]==="1"){v.add(d);v.add("+"+d);v.add(d.slice(1));v.add("+1"+d.slice(1));}
                  return Array.from(v);
                  }
                  async function findCallerName(phone: string) {
                    if (!SUPABASE_URL||!SUPABASE_KEY||!phone) return {name:null,isReturning:false};
                      const filter=phoneVariants(phone).map(v=>"phone.eq."+encodeURIComponent(v)).join(",");
                        try {
                            const r=await fetch(`${SUPABASE_URL}/rest/v1/mya_contacts?or=(${filter})&select=name,phone&limit=1`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
                                if(!r.ok) return {name:null,isReturning:false};
                                    const rows=await r.json();
                                        if(rows?.[0]) return {name:rows[0].full_name||rows[0].name||null,isReturning:true};
                                          } catch {}
                                            return {name:null,isReturning:false};
                                            }
                                            export default async function handler(req: VercelRequest, res: VercelResponse) {
                                              res.setHeader("Access-Control-Allow-Origin","*");
                                                if (req.method==="OPTIONS") return res.status(200).end();
                                                  if (req.method!=="POST") return res.status(405).json({ error:"Method not allowed" });
                                                    try {
                                                        const body=req.body||{};
                                                            if (req.query.action==="send-sub-sow") {
                                                                  const {sub_name,sub_phone,scope,price}=body;
                                                                        if (!sub_phone) return res.status(400).json({ error:"sub_phone required" });
                                                                              const scopeLines=Array.isArray(scope)?scope.join(", "):(scope||"See agreement");
                                                                                    await sendSms(sub_phone,`Elevate Construction - SOW | Sub: ${sub_name||sub_phone} | Scope: ${scopeLines} | Price: $${price||"TBD"} | Reply CONFIRM to acknowledge. -Elevate 404-719-1888`);
                                                                                          return res.status(200).json({ success:true });
                                                                                              }
                                                                                                  const prePhone=(body.caller_id||body.from||body.From||"").toString().trim();
                                                                                                      if (prePhone&&!body.conversation_id) {
                                                                                                            const {name,isReturning}=await findCallerName(prePhone);
                                                                                                                  const label=name||prePhone;
                                                                                                                        insertNotif({type:"incoming_call",severity:"info",title:"Incoming Call",message:`Mya is answering ${label}`,read:false,created_at:new Date().toISOString()}).catch(()=>{});
                                                                                                                              if(MICHAEL_PHONE) sendSms(MICHAEL_PHONE,`Incoming call — Mya is talking to ${label}`).catch(()=>{});
                                                                                                                                    return res.status(200).json({ dynamic_variables:{caller_name:name||"there",caller_is_returning:isReturning} });
                                                                                                                                        }
                                                                                                                                            const dur:number=body.call_duration_secs??body.duration_seconds??0;
                                                                                                                                                const endReason=body.end_reason||body.termination_reason||"";
                                                                                                                                                    const callerPhone=body.caller_phone||body.from||"";
                                                                                                                                                        const callerName=body.caller_name||"";
                                                                                                                                                            const isMissed=dur<45||endReason==="silence"||endReason==="no_answer"||endReason==="caller_hangup_early";
                                                                                                                                                                if (isMissed) {
                                                                                                                                                                      const label=callerName||callerPhone||"Unknown caller";
                                                                                                                                                                            const ts=new Date().toLocaleString("en-US",{timeZone:"America/New_York"});
                                                                                                                                                                                  await insertNotif({type:"missed_call",severity:"urgent",title:"Missed Call",message:`Mya missed a call from ${label} at ${ts}. Duration: ${dur}s.`,metadata:{caller_phone:callerPhone,duration_secs:dur,end_reason:endReason},read:false,created_at:new Date().toISOString()});
                                                                                                                                                                                        await sendSms(MICHAEL_PHONE,`MISSED CALL — Mya missed ${label} (${dur}s).`);
                                                                                                                                                                                            }
                                                                                                                                                                                                return res.status(200).json({ ok:true, missed:isMissed });
                                                                                                                                                                                                  } catch (err) { return res.status(500).json({ error:err instanceof Error?err.message:String(err) }); }
                                                                                                                                                                                                  }