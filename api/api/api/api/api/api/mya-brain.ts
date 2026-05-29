import type { VercelRequest, VercelResponse } from "@vercel/node";
const SUPABASE_URL=process.env.VITE_SUPABASE_URL||process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||"";
const TWILIO_SID=process.env.TWILIO_ACCOUNT_SID||"";
const TWILIO_TOKEN=process.env.TWILIO_AUTH_TOKEN||"";
const TWILIO_FROM=process.env.TWILIO_PHONE_NUMBER||"+16782440023";
const MICHAEL_PHONE=process.env.MICHAEL_PHONE||"";
const OPENAI_KEY=process.env.OPENAI_API_KEY||"";
const RESEND_KEY=process.env.RESEND_API_KEY||"";
const PROXY_SECRET=process.env.PROXY_SECRET||"";
const CRON_SECRET=process.env.CRON_SECRET||"";
async function supa(table:string,payload:Record<string,unknown>,method="POST") {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method,headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(payload)});
  }
  async function supaGet(path:string) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
    }
    async function sms(to:string,body:string) {
      if(!TWILIO_SID||!TWILIO_TOKEN||!to) return;
        const auth=Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,{method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:TWILIO_FROM,Body:body}).toString()});
          }
          async function escalate(data:any) {
            const msg=[`MYA ESCALATION`,data.caller_name?`Caller: ${data.caller_name}`:null,data.caller_phone?`Phone: ${data.caller_phone}`:null,data.reason?`Reason: ${data.reason}`:null,data.summary?`Summary: ${data.summary}`:null].filter(Boolean).join("\n");
              await sms(MICHAEL_PHONE,msg);
                await supa("mya_notifications",{type:"escalation",severity:"urgent",title:"Mya Escalation",message:msg,metadata:data,read:false,created_at:new Date().toISOString()});
                  return {escalated:true};
                  }
                  async function saveContact(data:any) {
                    if(!data.phone) return {error:"phone required"};
                      const ph=data.phone;
                        const exR=await supaGet(`mya_contacts?phone=eq.${encodeURIComponent(ph)}&limit=1`);
                          const existing=exR.ok?await exR.json():[];
                            if(existing.length>0) {
                                const id=existing[0].id;
                                    const upd:Record<string,any>={updated_at:new Date().toISOString(),total_calls:(existing[0].total_calls||0)+1,last_contact_at:new Date().toISOString()};
                                        for(const[k,v] of Object.entries(data)){if(v!=null&&v!==""&&k!=="phone")upd[k]=v;}
                                            await fetch(`${SUPABASE_URL}/rest/v1/mya_contacts?id=eq.${id}`,{method:"PATCH",headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(upd)});
                                                return {action:"updated",id};
                                                  }
                                                    const cr=await supa("mya_contacts",{...data,total_calls:1,last_contact_at:new Date().toISOString(),created_at:new Date().toISOString()});
                                                      const created=cr.ok?await cr.json():null;
                                                        return {action:"created",id:created?.[0]?.id};
                                                        }
                                                        export default async function handler(req:VercelRequest,res:VercelResponse) {
                                                          res.setHeader("Access-Control-Allow-Origin","*");
                                                            if(req.method==="OPTIONS") return res.status(200).end();
                                                              if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
                                                                const secret=req.headers["x-proxy-secret"]||req.headers["x-cron-secret"]||req.query.secret;
                                                                  if(!(PROXY_SECRET&&secret===PROXY_SECRET)&&!(CRON_SECRET&&secret===CRON_SECRET)) return res.status(401).json({error:"Unauthorized"});
                                                                    const body=req.body||{};
                                                                      const action=(body.action||req.query.action||"").toString().toLowerCase();
                                                                        try {
                                                                            let result:any;
                                                                                const d=body.data||body;
                                                                                    switch(action) {
                                                                                          case"save_contact":case"update_contact":result=await saveContact(d);break;
                                                                                                case"send_sms":if(!d.to||!d.message)return res.status(400).json({error:"to and message required"});await sms(d.to,d.message);await supa("mya_actions",{type:"sms_sent",payload:d,status:"sent",executed_at:new Date().toISOString(),created_at:new Date().toISOString()});result={sent:true};break;
                                                                                                      case"escalate":case"escalate_to_michael":result=await escalate(d);break;
                                                                                                            case"schedule_follow_up":await supa("mya_actions",{type:"follow_up",status:"pending",payload:d,created_at:new Date().toISOString()});if(MICHAEL_PHONE)await sms(MICHAEL_PHONE,`Mya scheduled follow-up with ${d.contact_name||d.contact_phone} for ${d.follow_up_date||"TBD"}`);result={scheduled:true};break;
                                                                                                                  case"log_action":result=(await supa("mya_actions",{...d,status:d.status||"pending",created_at:new Date().toISOString()})).ok?{logged:true}:{error:"failed"};break;
                                                                                                                        case"hiring_intake":await supa("mya_actions",{type:"hiring_intake",status:"pending",payload:d,created_at:new Date().toISOString()});if(MICHAEL_PHONE)await sms(MICHAEL_PHONE,`NEW HIRING INQUIRY — Name: ${d.name||"?"} | Trade: ${d.trade||"?"} | Phone: ${d.phone||"?"} | Compensation: ${d.desired_compensation||"?"}`);result={intake_saved:true};break;
                                                                                                                              case"lookup_caller":if(!d.phone)return res.status(200).json({found:false});const lr=await supaGet(`mya_contacts?phone=eq.${encodeURIComponent(d.phone)}&limit=1`);const lrows=lr.ok?await lr.json():[];result=lrows[0]?{found:true,name:lrows[0].name||lrows[0].full_name,contact:lrows[0]}:{found:false};break;
                                                                                                                                    default:if(body.tool_name){req.body={action:body.tool_name.toLowerCase().replace(/-/g,"_"),data:body.parameters||body};return handler(req,res);}return res.status(400).json({error:`Unknown action: ${action}`});
                                                                                                                                        }
                                                                                                                                            return res.status(200).json({ok:true,...result});
                                                                                                                                              } catch(err:any){return res.status(500).json({error:err?.message||"Internal error"});}
                                                                                                                                              }