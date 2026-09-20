import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/* ── env ─────────────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";
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

/** Extract customer-provided callback number from transcript */
function extractCustomerPhone(transcript: any[]): string | null {
  if (!Array.isArray(transcript)) return null;

  const userText = transcript
    .filter((t: any) => t.role === "user")
    .map((t: any) => t.message || t.text || "")
    .join(" ");

  const match = userText.match(
    /(?:\+?1[-.\s]?)?(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})/
  );

  if (!match) return null;

  return `+1${match[1]}${match[2]}${match[3]}`;
}

/** Extract a clean property street address from transcript */
function extractPropertyAddress(transcript: any[]): string | null {
  if (!Array.isArray(transcript)) return null;

  const userText = transcript
    .filter((t: any) => t.role === "user")
    .map((t: any) => t.message || t.text || "")
    .join(" ");

  const match = userText.match(
    /\b(\d+\s+(?:[A-Za-z0-9'-]+\s+){0,5}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Circle|Place|Pl))\b/i
  );

  return match?.[1]?.trim() || null;
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
  const propertyAddress = extractPropertyAddress(transcript);
  if (propertyAddress) bullets.push(`📍 ${propertyAddress}`);

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

    /**
 * ElevenLabs Data Collection returns objects shaped like:
 * { data_collection_id, name, value, json_schema, rationale }
 * This helper safely extracts the actual collected value.
 */
function getCollectedValue(value: any): any {
  if (value === null || value === undefined) return null;

  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return value.value ?? null;
  }

  return value;
}

// Structured data collected by ElevenLabs
const collected = analysis.data_collection_results || {};

// Safely unwrap ElevenLabs Data Collection values
const collectedValue = (key: string) =>
  getCollectedValue(collected?.[key]);



// Prefer structured ElevenLabs data, with transcript extraction as fallback
const rawCollectedPhone = collectedValue("caller_phone");
const structuredPhone = rawCollectedPhone
  ? String(rawCollectedPhone).replace(/\D/g, "")
  : "";

const normalizedStructuredPhone =
  structuredPhone.length === 10
    ? `+1${structuredPhone}`
    : structuredPhone.length === 11 && structuredPhone.startsWith("1")
      ? `+${structuredPhone}`
      : "";

const customerPhone =
  normalizedStructuredPhone || extractCustomerPhone(transcript);

const propertyAddress =
  collected.property_address || extractPropertyAddress(transcript);

const crmPhone = customerPhone || callerNumber;

const collectedName = getCollectedValue(collected.caller_name);

const callerName =
  typeof collectedName === "string" && collectedName.trim()
    ? collectedName.trim()
    : extractCallerName(transcript);

const callerIntent =
  collected.caller_intent ||
  analysis.transcript_summary?.slice(0, 200) ||
  "";

const callerType = collected.caller_type || "other";
const callPurpose = collected.call_purpose || "other";
const preferredLanguage = collected.preferred_language || "unknown";
const companyName = collected.company_name || null;
const requiresMichael = collected.requires_michael === true;

const projectType = collected.project_type || null;
const projectDescription = collected.project_description || null;
const timeline = collected.timeline || null;
const budgetRange = collected.budget_range || null;
const decisionMakers = collected.decision_makers || null;
const motivation = collected.motivation || null;
const contractorHistory = collected.contractor_history || null;
const leadSource = collected.lead_source || null;

const trade = collected.trade || null;
const crewSize = collected.crew_size ?? null;
const serviceArea = collected.service_area || null;
const subcontractorInsuranceStatus =
  collected.subcontractor_insurance_status || null;
const availability = collected.availability || null;

const callOutcome =
  analysis.call_successful || body.status || "completed";

    // Full transcript as text
    const transcriptText = Array.isArray(transcript)
      ? transcript
          .map((t: any) => `${t.role === "agent" ? "Mya" : "Caller"}: ${t.message || t.text || ""}`)
          .join("\n")
      : JSON.stringify(transcript);

    // Log key fields for debugging
console.log(
  "mya-data-collection:",
  JSON.stringify({
    caller_name: collected.caller_name,
    caller_type: collected.caller_type,
    call_purpose: collected.call_purpose,
    preferred_language: collected.preferred_language,
    caller_phone: collected.caller_phone,
    company_name: collected.company_name,
    property_address: collected.property_address,
    requires_michael: collected.requires_michael,
    project_type: collected.project_type,
    project_description: collected.project_description,
    timeline: collected.timeline,
    budget_range: collected.budget_range,
    decision_makers: collected.decision_makers,
    motivation: collected.motivation,
    contractor_history: collected.contractor_history,
    lead_source: collected.lead_source,
  })
);

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

/* 2. Sync Mya contact + conversation ─────────────────────── */
let contactId: string | null = null;

if (crmPhone) {
  const { data: existingContact, error: contactLookupErr } = await supabase
    .from("mya_contacts")
    .select(
      "id,name,company,address,project_type,lead_source,total_calls"
    )
    .eq("phone", crmPhone)
    .maybeSingle();

  if (contactLookupErr) {
    console.error("Mya contact lookup error:", contactLookupErr);
  } else if (existingContact) {
    contactId = existingContact.id;

    const { error: contactUpdateErr } = await supabase
      .from("mya_contacts")
      .update({
        name: callerName || existingContact.name || null,
        company: companyName || existingContact.company || null,
        address: propertyAddress || existingContact.address || null,
        project_type:
          projectType || existingContact.project_type || null,
        lead_source:
          leadSource || existingContact.lead_source || "phone",
        last_call_summary: callerIntent || null,
        total_calls: (existingContact.total_calls || 0) + 1,
        last_contact_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingContact.id);

    if (contactUpdateErr) {
      console.error("Mya contact update error:", contactUpdateErr);
    }
  } else {
    const { data: newContact, error: contactInsertErr } = await supabase
      .from("mya_contacts")
      .insert({
        phone: crmPhone,
        name: callerName || null,
        company: companyName,
        address: propertyAddress,
        project_type: projectType,
        lead_source: leadSource || "phone",
        status: "new",
        last_call_summary: callerIntent || null,
        total_calls: 1,
        last_contact_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (contactInsertErr) {
      console.error("Mya contact insert error:", contactInsertErr);
    } else {
      contactId = newContact?.id || null;
    }
  }
}

    const callSuccessful =
      callOutcome === true ||
      String(callOutcome).toLowerCase() === "success" ||
      String(callOutcome).toLowerCase() === "successful" ||
      String(callOutcome).toLowerCase() === "completed";

    const { error: conversationErr } = await supabase
      .from("mya_conversations")
      .upsert(
        {
          conversation_id: conversationId,
          contact_id: contactId,
          phone: callerNumber || null,
          direction,
          duration_secs: durationSecs,
          summary: callerIntent || null,
          transcript: transcriptText,
          call_successful: callSuccessful,
        },
        {
          onConflict: "conversation_id",
        }
      );

    if (conversationErr) {
      console.error("Mya conversation insert error:", conversationErr);
    }

    /* 2B. Sync persistent customer profile ───────────────────────── */
    if (contactId) {
      const now = new Date();
      const nowIso = now.toISOString();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      const { data: existingProfile, error: profileLookupErr } =
        await supabase
          .from("mya_customer_profiles")
          .select(
            "id,preferred_name,relationship_type,relationship_summary,current_context,memory_summary,communication_preferences,important_notes,open_follow_ups,first_contact_at,last_contact_at,last_call_at,calls_today,lifetime_calls,last_call_summary"
          )
          .eq("contact_id", contactId)
          .maybeSingle();

      if (profileLookupErr) {
        console.error("Mya customer profile lookup error:", profileLookupErr);
      } else {
        const previousLastCall = existingProfile?.last_call_at
          ? new Date(existingProfile.last_call_at)
          : null;

        const calledEarlierToday =
          previousLastCall !== null &&
          previousLastCall >= todayStart;

        const nextCallsToday = existingProfile
          ? calledEarlierToday
            ? (existingProfile.calls_today || 0) + 1
            : 1
          : 1;

        const nextLifetimeCalls =
          (existingProfile?.lifetime_calls || 0) + 1;

        const relationshipType =
          callerType === "existing_client"
            ? "existing_client"
            : callerType === "prospective_client"
              ? "prospective_client"
              : callerType || existingProfile?.relationship_type || "unknown";

        const relationshipSummary =
          existingProfile?.relationship_summary ||
          (callerName && projectType
            ? `${callerName} contacted Elevate Construction regarding ${projectType}.`
            : callerName
              ? `${callerName} is a contact of Elevate Construction.`
              : null);

        const currentContext =
          projectDescription ||
          callerIntent ||
          existingProfile?.current_context ||
          null;

        const memorySummaryParts = [
          existingProfile?.memory_summary || null,
          callerIntent
            ? `Latest call: ${callerIntent}`
            : null,
        ].filter(Boolean);

        const memorySummary =
          memorySummaryParts.length > 0
            ? memorySummaryParts.join("\n").slice(-4000)
            : null;

        const profilePayload = {
          contact_id: contactId,
          preferred_name:
            callerName ||
            existingProfile?.preferred_name ||
            null,
          relationship_type: relationshipType,
          relationship_summary: relationshipSummary,
          current_context: currentContext,
          memory_summary: memorySummary,
          communication_preferences:
            existingProfile?.communication_preferences || null,
          important_notes:
            existingProfile?.important_notes || null,
          open_follow_ups:
            existingProfile?.open_follow_ups || null,
          first_contact_at:
            existingProfile?.first_contact_at || nowIso,
          last_contact_at: nowIso,
          last_call_at: nowIso,
          calls_today: nextCallsToday,
          lifetime_calls: nextLifetimeCalls,
          last_call_summary:
            callerIntent ||
            existingProfile?.last_call_summary ||
            null,
          updated_at: nowIso,
        };

        const { error: profileUpsertErr } = await supabase
          .from("mya_customer_profiles")
          .upsert(profilePayload, {
            onConflict: "contact_id",
          });

        if (profileUpsertErr) {
          console.error(
            "Mya customer profile upsert error:",
            profileUpsertErr
          );
        } else {
          console.log("Mya customer profile synced:", {
            contactId,
            preferredName: profilePayload.preferred_name,
            callsToday: nextCallsToday,
            lifetimeCalls: nextLifetimeCalls,
            returningToday: calledEarlierToday,
          });
        }
      }
    }
    /* 3. Create project intake when this call is a new project lead ─────── */
    const shouldCreateProjectIntake =
      callerType === "prospective_client" &&
      [
        "new_project",
        "damage_restoration",
        "estimate_or_consultation",
        "insurance_claim",
      ].includes(callPurpose);

    console.log("Mya intake decision:", {
      callerType,
      callPurpose,
      shouldCreateProjectIntake,
    });

    if (shouldCreateProjectIntake) {
      const { data: intakeData, error: intakeErr } = await supabase
        .from("mya_intakes")
        .insert({
          full_name: callerName || null,
          phone: crmPhone || null,
          property_address: propertyAddress || null,
          company_name: companyName,
          project_type: projectType,
          motivation,
          project_description: projectDescription,
          timeline,
          budget_range: budgetRange,
          decision_makers: decisionMakers,
          contractor_history: contractorHistory,
          lead_source: leadSource || "phone",
          call_disposition: callerIntent || null,
          notes: requiresMichael
            ? "Requires Michael follow-up."
            : null,
          status: "new",
          qualified_by: "Mya",
        })
        .select("id,full_name,phone,project_type,lead_source,created_at");

      console.log("Mya intake result:", {
        shouldCreateProjectIntake,
        callerType,
        callPurpose,
        data: intakeData,
        error: intakeErr,
      });

      if (intakeErr) {
        console.error("Mya intake insert error:", intakeErr);
      }
    }
    /* 4. SMS summary to owner ────────────────────────────────── */    const summaryTitle    = analysis.call_summary_title || "";
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
