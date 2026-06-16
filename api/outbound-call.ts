import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/* ── env ─────────────────────────────────────────────────────── */
const SUPABASE_URL        = process.env.SUPABASE_URL || "";
const SUPABASE_KEY        = process.env.SUPABASE_SERVICE_KEY || "";
const ELEVENLABS_API_KEY  = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID || "";
const ELEVENLABS_PHONE_ID = process.env.ELEVENLABS_PHONE_NUMBER_ID || "";
const TWILIO_SID          = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN        = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM         = process.env.TWILIO_PHONE_NUMBER || "+16782440023";
const OWNER_PHONE         = process.env.OWNER_PHONE_NUMBER || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── helpers ─────────────────────────────────────────────────── */

/** Send an SMS via Twilio REST API */
async function sendSms(to: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !to) return;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString(),
    }
  );
}

/** Normalise phone to E.164 (+1XXXXXXXXXX) */
function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return raw.startsWith("+") ? raw : "+" + digits;
}

/** Trigger an ElevenLabs outbound call to the lead */
async function triggerOutboundCall(phone: string, leadName: string) {
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound_call", {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      agent_id: ELEVENLABS_AGENT_ID,
      agent_phone_number_id: ELEVENLABS_PHONE_ID,
      to_number: normalisePhone(phone),
      conversation_initiation_client_data: {
        conversation_config_override: {
          agent: {
            first_message: `Hello ${leadName || "there"}, this is Mya from Elevate Construction. I'm calling because you just submitted a request on our website — in great detail, could you tell us what's going on at your property?`,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("ElevenLabs call failed:", res.status, errText);
    return { ok: false, error: errText };
  }

  return { ok: true, data: await res.json() };
}

/* ── handler ─────────────────────────────────────────────────── */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const name        = (body.name || "").trim();
    const phone       = (body.phone || "").trim();
    const email       = (body.email || "").trim();
    const address     = (body.address || "").trim();
    const description = (body.description || "").trim();
    const timeline    = (body.timeline || "").trim();
    const source      = (body.source || "website").trim();

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    /* 1. Save lead to Supabase ──────────────────────────────── */
    const { data: lead, error: dbErr } = await supabase
      .from("leads")
      .insert({
        name,
        phone: normalisePhone(phone),
        email: email || null,
        address: address || null,
        description: description || null,
        timeline: timeline || null,
        source,
      })
      .select()
      .single();

    if (dbErr) {
      console.error("Supabase insert error:", dbErr);
      // Don't block the call — log and continue
    }

    /* 2. Trigger ElevenLabs outbound call ────────────────────── */
    const callResult = await triggerOutboundCall(phone, name);

    /* 3. SMS the owner ───────────────────────────────────────── */
    const label = name || phone;
    await sendSms(
      OWNER_PHONE,
      `🚨 New lead — ${label}, ${normalisePhone(phone)}${email ? `, ${email}` : ""} — Mya is calling them now.`
    );

    return res.status(200).json({
      success: true,
      lead_id: lead?.id || null,
      call_triggered: callResult.ok,
    });
  } catch (err: any) {
    console.error("outbound-call error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
