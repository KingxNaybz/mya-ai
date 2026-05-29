import type { VercelRequest, VercelResponse } from "@vercel/node";
const EL_KEY = process.env.ELEVENLABS_API_KEY || "";
const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { text } = req.body || {};
      if (!text) return res.status(400).json({ error: "Missing text" });
        const clean = String(text).replace(/[*_#`>\\]/g,"").replace(/\n+/g,". ").replace(/\s+/g," ").trim().slice(0,4000);
          try {
              if (EL_KEY && EL_VOICE) {
                    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}`, {
                            method:"POST", headers:{"xi-api-key":EL_KEY,"Content-Type":"application/json",Accept:"audio/mpeg"},
                                    body:JSON.stringify({text:clean,model_id:"eleven_turbo_v2_5",voice_settings:{stability:0.4,similarity_boost:0.8,style:0.35,use_speaker_boost:true}})
                                          });
                                                if (r.ok) { res.setHeader("Content-Type","audio/mpeg"); res.setHeader("X-TTS-Source","elevenlabs"); return res.send(Buffer.from(await r.arrayBuffer())); }
                                                    }
                                                        if (OAI_KEY) {
                                                              const r = await fetch("https://api.openai.com/v1/audio/speech", {
                                                                      method:"POST", headers:{Authorization:`Bearer ${OAI_KEY}`,"Content-Type":"application/json"},
                                                                              body:JSON.stringify({model:"tts-1",input:clean,voice:"nova",response_format:"mp3"})
                                                                                    });
                                                                                          if (r.ok) { res.setHeader("Content-Type","audio/mpeg"); res.setHeader("X-TTS-Source","openai"); return res.send(Buffer.from(await r.arrayBuffer())); }
                                                                                              }
                                                                                                  return res.status(500).json({ error: "All TTS providers failed." });
                                                                                                    } catch (err:any) { return res.status(500).json({ error: err?.message }); }
                                                                                                    }