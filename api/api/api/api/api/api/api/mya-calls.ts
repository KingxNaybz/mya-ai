import type { VercelRequest, VercelResponse } from "@vercel/node";
const EL_KEY=process.env.ELEVENLABS_API_KEY||"";
const AGENT_ID=process.env.ELEVENLABS_PHONE_AGENT_ID||process.env.ELEVENLABS_AGENT_ID||"";
const PROXY_SECRET=process.env.PROXY_SECRET||"";
const SUPABASE_URL=process.env.VITE_SUPABASE_URL||process.env.SUPABASE_URL||"";
const SUPABASE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY||"";
async function fetchDetail(id:string) {
  try {
      const r=await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`,{headers:{"xi-api-key":EL_KEY}});
          if(!r.ok) return null;
              return await r.json();
                } catch { return null; }
                }
                function getCallerName(transcript:any[]) {
                  const text=transcript.filter(t=>t.role==="user").map(t=>t.message).join(" ");
                    for(const p of [/my name is (\w+(?:\s+\w+)?)/i,/this is (\w+(?:\s+\w+)?)/i,/i'm (\w+(?:\s+\w+)?)/i]) {
                        const m=text.match(p);
                            if(m&&m[1]&&m[1].length<40) return m[1].split(" ").map((w:string)=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(" ");
                              }
                                return null;
                                }
                                export default async function handler(req:VercelRequest,res:VercelResponse) {
                                  res.setHeader("Access-Control-Allow-Origin","*");
                                    if(req.method==="OPTIONS") return res.status(200).end();
                                      if(req.method!=="GET") return res.status(405).json({error:"Method not allowed"});
                                        const secret=req.headers["x-proxy-secret"]||req.query.secret;
                                          if(!PROXY_SECRET||secret!==PROXY_SECRET) return res.status(401).json({error:"Unauthorized"});
                                            const convId=req.query.id as string|undefined;
                                              const pageSize=Math.min(Number(req.query.limit)||30,100);
                                                if(!EL_KEY||!AGENT_ID) {
                                                    const r=await fetch(`${SUPABASE_URL}/rest/v1/mya_conversations?order=started_at.desc.nullsfirst&limit=${pageSize}`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}});
                                                        if(!r.ok) return res.status(500).json({error:await r.text()});
                                                            const convs=await r.json();
                                                                return res.status(200).json({calls:convs.map((c:any)=>({conversation_id:c.conversation_id,phone:c.phone||"unknown",started_at:c.started_at,duration_secs:c.duration_secs||0,summary:c.summary})),total:convs.length});
                                                                  }
                                                                    try {
                                                                        if(convId) {
                                                                              const d=await fetchDetail(convId);
                                                                                    if(!d) return res.status(404).json({error:"Not found"});
                                                                                          const phone=d.metadata?.phone_call?.external_number||d.user_id||"unknown";
                                                                                                const raw:any[]=Array.isArray(d.transcript)?d.transcript:[];
                                                                                                      const transcript=raw.map((t:any)=>({role:t.role==="agent"||t.role==="assistant"?"agent":"user",message:(t.message??t.text??t.transcript??"").toString(),time:t.time_in_call_secs})).filter((t:any)=>t.message?.trim());
                                                                                                            return res.status(200).json({conversation_id:convId,status:d.status,phone,started_at:d.metadata?.start_time_unix_secs?new Date(d.metadata.start_time_unix_secs*1000).toISOString():null,duration_secs:d.metadata?.call_duration_secs||0,transcript,summary:d.analysis?.transcript_summary||null,successful:d.analysis?.call_successful||null});
                                                                                                                }
                                                                                                                    const lr=await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${AGENT_ID}&page_size=${pageSize}`,{headers:{"xi-api-key":EL_KEY}});
                                                                                                                        if(!lr.ok) return res.status(lr.status).json({error:await lr.text()});
                                                                                                                            const ld=await lr.json();
                                                                                                                                const completed=(ld.conversations||[]).filter((c:any)=>c.status==="done");
                                                                                                                                    const details=await Promise.all(completed.slice(0,pageSize).map(async(c:any)=>{
                                                                                                                                          try {
                                                                                                                                                  const d=await fetchDetail(c.conversation_id);
                                                                                                                                                          if(!d) return null;
                                                                                                                                                                  const phone=d.metadata?.phone_call?.external_number||d.user_id||"unknown";
                                                                                                                                                                          const raw:any[]=Array.isArray(d.transcript)?d.transcript:[];
                                                                                                                                                                                  const transcript=raw.map((t:any)=>({role:t.role==="agent"?"agent":"user",message:(t.message??t.text??t.transcript??"").toString()})).filter((t:any)=>t.message?.trim());
                                                                                                                                                                                          return {conversation_id:c.conversation_id,status:d.status,phone,direction:d.metadata?.phone_call?.direction||"unknown",started_at:d.metadata?.start_time_unix_secs?new Date(d.metadata.start_time_unix_secs*1000).toISOString():null,duration_secs:d.metadata?.call_duration_secs||0,transcript_preview:transcript.find((t:any)=>t.role==="user")?.message?.slice(0,150)||"Call connected",caller_name:getCallerName(transcript),summary:d.analysis?.transcript_summary||null,successful:d.analysis?.call_successful||null};
                                                                                                                                                                                                } catch { return null; }
                                                                                                                                                                                                    }));
                                                                                                                                                                                                        return res.status(200).json({calls:details.filter(Boolean),total:ld.conversations?.length||0});
                                                                                                                                                                                                          } catch(err:any) { return res.status(500).json({error:err.message}); }
                                                                                                                                                                                                          }