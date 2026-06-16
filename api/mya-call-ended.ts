import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/* ── env ─────────────────────────────────────────────────────── */
const SUPABASE_URL   = process.env.SUPABASE_URL || "";
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || "";
const TWILIO_SID     = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN   = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM    = process.env.TWILIO_PHONE_NUMBER || "+16782440023";
const OWNER_PHONE    = process.env.OWNER_PHONE_NUMBER || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── helpers ─────────────────────────────────────────────────── */

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

/** Extract caller name from transcript if available */
function extractCallerName(transcript: any[]): string | null {
  if (!Array.isArray(transcript)) return null;
  const userText = transcript
    .filter((t: any) => t.role === "user")
    .map((t: any) => t.message || t.text || "")
    .join(" ");

  for (const pattern of [
    /my name is (\w+(?:\s+\w+)?)/i,
    /this is (\w+(?:\s+\w+)?)/i,
    /i'm (\w+(?:\s+\w+)?)/i,
  ]) {
    const match = userText.match(pattern);
    if (match?.[1] && match[1].length < 40) {
      return match[1]
        .split(" ")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }
  return null;
}

/** Build bullet-point details from transcript */
function extractBullets(transcript: any[]): string[] {
  if (!Array.isArray(transcript)) return [];
  const userText = transcript
    .filter((t: any) => t.role === "user")
    .map((t: any) => (t.message || t.text || "").trim())
    .filter(Boolean)
    .join(" ");
  const bullets: string[] = [];

  // Address
  const addrMatch = userText.match(/(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|circle|place|pl)[,.\s]*[\w\s]*(?:georgia|ga|atlanta)?)/i);
  if (addrMatch) bullets.push(`📍 ${addrMatch[1].trim()}`);

  // Phone mentioned by caller (different from their caller ID)
  const phoneMatch = userText.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/);
  if (phoneMatch) bullets.push(`📱 ${phoneMatch[1]}`);

  // Service keywords
  const services = userText.match(/\b(roof\s*leak|water\s*damage|flood|mold|fire\s*damage|storm\s*damage|hail|wind|leak|restoration|renovation|remodel|plumbing|electrical|hvac|foundation|siding|gutters?|drywall|painting|demo(?:lition)?|inspection)\b/gi);
  if (services) {
    const unique = [...new Set(services.map((s: string) => s.toLowerCase()))];
    bullets.push(`🔧 ${unique.join(", ")}`);
  }

  // Urgency
  if (/\b(emergency|urgent|asap|immediately|24.?hour|right away|flooding|water coming)\b/i.test(userText)) {
    bullets.push("⚡ URGENT");
  }

  return bullets;
}

/** Build the full SMS with bullet-point summary */
function buildSmsSummary(data: {
  callerName: string | null;
  callerPhone: string;
  direction: string;
  outcome: string;
  duration: number;
  intent: string;
  conversationId: string;
  summaryTitle: string;
  transcriptSummary: string;
  transcript: any[];
}): string {
  const label = data.callerName || data.callerPhone || "Unknown";
  const dir = data.direction === "outbound" ? "Outbound" : "Inbound";
  const mins = Math.round(data.duration / 60);
  const durStr = mins > 0 ? `${mins}m` : `${data.duration}s`;

  const lines: string[] = [
    `📞 ${dir} call — ${label}`,
    `⏱ ${durStr} | ${data.outcome || "completed"}`,
  ];

  // Bullet-point summary from transcript analysis
  if (data.transcriptSummary) {
    lines.push("");
    lines.push(`📋 Summary:`);
    // Split the summary into sentence-level bullets
    const sentences = data.transcriptSummary
      .split(/(?<=[.!?])\s+/)
      .filter((s: string) => s.length > 10)
      .slice(0, 4);
    for (const s of sentences) {
      lines.push(`• ${s.trim()}`);
    }
  } else if (data.intent) {
    lines.push("");
    lines.push(`📋 ${data.intent}`);
  }

  // Extracted details from transcript
  const bullets = extractBullets(data.transcript);
  if (bullets.length > 0) {
    lines.push("");
    lines.push(bullets.join("\n"));
  }

  // Conversation link
  if (data.conversationId) {
    lines.push("");
    lines.push(`🎧 Listen: https://elevenlabs.io/app/conversational-ai/history?conversation_id=${data.conversationId}`);
  }

  return lines.join("\n");
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
    const rawBody = req.body || {};

    /*
     * ElevenLabs workspace post-call webhook can send the payload in two formats:
     *   1. Wrapped: { type: "post_call_transcript", event_timestamp: ..., data: { ...conversation... } }
     *   2. Direct: { conversation_id, agent_id, ... }
     * Handle both by unwrapping if a "data" key is present.
     */
    const body = rawBody.data && rawBody.data.conversation_id ? rawBody.data : rawBody;

    const conversationId = body.conversation_id || "";
    const agentId        = body.agent_id || "";
    const metadata       = body.metadata || {};
    const phoneCall      = metadata.phone_call || {};
    const analysis       = body.analysis || {};
    const transcript     = body.transcript || [];

    const direction      = phoneCall.direction || "unknown";
    const callerNumber   = phoneCall.external_number || "";
    const calledNumber   = phoneCall.called_number || phoneCall.agent_number || "";
    const durationSecs   = metadata.call_duration_secs || 0;
    const messageCount   = Array.isArray(transcript) ? transcript.length : 0;

    // Extract info from analysis or transcript
    const callerName     = analysis.data_collection_results?.caller_name
                           || extractCallerName(transcript);
    const callerIntent   = analysis.data_collection_results?.caller_intent
                           || analysis.transcript_summary?.slice(0, 200)
                           || "";
    const callOutcome    = analysis.call_successful || body.status || "completed";

    // Full transcript as text
    const transcriptText = Array.isArray(transcript)
      ? transcript
          .map((t: any) => `${t.role === "agent" ? "Mya" : "Caller"}: ${t.message || t.text || ""}`)
          .join("\n")
      : JSON.stringify(transcript);

    // Log key fields for debugging
    console.log("mya-call-ended:", JSON.stringify({
      conversationId,
      direction,
      callerNumber,
      durationSecs,
      hasTranscript: Array.isArray(transcript) && transcript.length > 0,
      bodyKeys: Object.keys(rawBody),
      isWrapped: !!(rawBody.data && rawBody.data.conversation_id),
    }));

    /* 1. Save call to Supabase ──────────────────────────────── */
    const { error: dbErr } = await supabase.from("calls").insert({
      conversation_id: conversationId,
      agent_id: agentId,
      direction,
      caller_number: callerNumber,
      called_number: calledNumber,
      caller_name: callerName || null,
      caller_intent: callerIntent || null,
      call_outcome: callOutcome,
      duration_secs: durationSecs,
      message_count: messageCount,
      transcript: transcriptText,
    });

    if (dbErr) {
      console.error("Supabase calls insert error:", dbErr);
    }

    /* 2. SMS summary to owner ────────────────────────────────── */
    const summaryTitle    = analysis.call_summary_title || "";
    const transcriptSum   = analysis.transcript_summary || "";

    await sendSms(
      OWNER_PHONE,
      buildSmsSummary({
        callerName,
        callerPhone: callerNumber,
        direction,
        outcome: callOutcome,
        duration: durationSecs,
        intent: callerIntent,
        conversationId,
        summaryTitle: summaryTitle,
        transcriptSummary: transcriptSum,
        transcript,
      })
    );

    return res.status(200).json({ ok: true, conversation_id: conversationId });
  } catch (err: any) {
    console.error("mya-call-ended error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
