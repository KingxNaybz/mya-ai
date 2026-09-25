import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * RECEPTION / EXECUTIVE DATA BOUNDARY — enforced here, not by prompting.
 *
 * This file is Reception Mya's ONLY source of live business data (it runs
 * at the start of every phone call, before a human says a word) — it must
 * never select from mya_projects, mya_approvals, mya_action_log, or any
 * employee/vendor/financial table. Its two data sources (mya_contacts,
 * mya_customer_profiles) are looked up by the caller's OWN phone number
 * only, so this can never return a different customer's record.
 *
 * Within those two tables, PHONE_SAFE_FIELDS below is the complete,
 * explicit list of what's allowed to reach ElevenLabs as a dynamic
 * variable. buildPhoneSafeVariables() is the single place that assembles
 * the actual response, and it only ever reads keys from this list off
 * whatever candidate object it's given — so adding a new column to either
 * table later (or accidentally spreading a whole row into the candidate)
 * does NOT automatically expose it here. Widening this list is a
 * deliberate, one-line, reviewable change, not an accident.
 *
 * important_notes and open_follow_ups are deliberately NOT on this list.
 * Both are free-text catch-alls that no code path in this repo currently
 * writes (mya-call-ended.ts only ever carries forward whatever was already
 * there) — they exist for future internal/manual CRM notes, exactly the
 * kind of content ("margin's thin on this one," "CEO said no discount")
 * that must never reach a live customer call. communication_preferences
 * is kept: unlike the other two, its whole purpose is a customer-facing
 * contact preference ("prefers texts over calls"), not internal strategy.
 */
const PHONE_SAFE_FIELDS = [
  "known_caller",
  "known_name",
  "preferred_name",
  "relationship_type",
  "calls_today",
  "returning_today",
  "company_name",
  "property_address",
  "project_type",
  "relationship_summary",
  "current_context",
  "memory_summary",
  "last_call_summary",
  "communication_preferences",
] as const;

type PhoneSafeKey = (typeof PHONE_SAFE_FIELDS)[number];
type PhoneSafeVariables = Record<PhoneSafeKey, string>;

/** The only place a dynamic_variables object is ever produced. Reads ONLY
 * the allowlisted keys off `candidate` — any other key present on it
 * (today or added later) is silently dropped, never forwarded. */
function buildPhoneSafeVariables(candidate: Partial<Record<PhoneSafeKey, string>>): PhoneSafeVariables {
  const safe = {} as PhoneSafeVariables;
  for (const key of PHONE_SAFE_FIELDS) {
    safe[key] = candidate[key] ?? "";
  }
  return safe;
}

// Shared "nothing known yet" shape for the three cases where the caller
// can't be identified (no number, lookup error, no match) — same values
// as before this change, just defined once instead of three times, and
// still routed through the same allowlist as every other response.
const UNKNOWN_CALLER_VARIABLES = buildPhoneSafeVariables({
  known_caller: "false",
  known_name: "false",
  preferred_name: "",
  relationship_type: "unknown",
  calls_today: "0",
  returning_today: "false",
  company_name: "",
  property_address: "",
  project_type: "",
  relationship_summary: "",
  current_context: "",
  memory_summary: "",
  last_call_summary: "",
  communication_preferences: "",
});

function unknownCallerResponse() {
  return {
    type: "conversation_initiation_client_data",
    dynamic_variables: UNKNOWN_CALLER_VARIABLES,
  };
}

function normalizePhone(value: unknown): string {
  if (!value) return "";

  const digits = String(value).replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  return String(value).trim();
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    const rawCallerNumber =
      body.caller_id ||
      body.caller_number ||
      body.from_number ||
      body.from ||
      body.phone_number ||
      "";

    const callerPhone = normalizePhone(rawCallerNumber);

    console.log("Mya call-start lookup:", {
      callerPhone: callerPhone || null,
      hasCallerPhone: Boolean(callerPhone),
    });

    if (!callerPhone) {
      return res.status(200).json(unknownCallerResponse());
    }

    const { data: contact, error: contactErr } = await supabase
      .from("mya_contacts")
      .select(
        "id,name,company,address,project_type,status,last_call_summary,total_calls,last_contact_at"
      )
      .eq("phone", callerPhone)
      .maybeSingle();

    if (contactErr) {
      console.error("Mya call-start contact lookup error:", contactErr);
      return res.status(200).json(unknownCallerResponse());
    }

    if (!contact) {
      return res.status(200).json(unknownCallerResponse());
    }

    const { data: profile, error: profileErr } = await supabase
      .from("mya_customer_profiles")
      .select(
        "preferred_name,relationship_type,relationship_summary,current_context,memory_summary,communication_preferences,last_call_at,calls_today,lifetime_calls,last_call_summary"
      )
      .eq("contact_id", contact.id)
      .maybeSingle();

    if (profileErr) {
      console.error("Mya call-start profile lookup error:", profileErr);
    }

    let returningToday = false;
    let callsToday = 0;

    if (profile?.last_call_at) {
      const lastCall = new Date(profile.last_call_at);
      const now = new Date();

      returningToday =
        lastCall.getFullYear() === now.getFullYear() &&
        lastCall.getMonth() === now.getMonth() &&
        lastCall.getDate() === now.getDate();

      callsToday = returningToday
        ? profile.calls_today || 0
        : 0;
    }

    const rawPreferredName =
      profile?.preferred_name ||
      contact.name ||
      "";

    const preferredName =
      typeof rawPreferredName === "string" &&
      rawPreferredName.trim() &&
      rawPreferredName.trim() !== "[object Object]"
        ? rawPreferredName.trim()
        : "";

    const hasKnownName = Boolean(preferredName);

    const greetingName =
      preferredName.split(/\s+/)[0] || "";

    const firstMessage =
      returningToday && greetingName
        ? `Hey ${greetingName}, how's it going?`
        : greetingName
          ? `It's a great day at Elevate! This is Mya speaking. Hi ${greetingName}, how are you today?`
          : `It's a great day at Elevate! This is Mya speaking. How can I help you today?`;
    console.log("Mya recognized caller:", {
      contactId: contact.id,
      preferredName,
      returningToday,
      callsToday,
    });

    return res.status(200).json({
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent: {
          first_message: firstMessage,
        },
      },
      dynamic_variables: buildPhoneSafeVariables({
        known_caller: "true",
        known_name: hasKnownName ? "true" : "false",
        preferred_name: preferredName,
        relationship_type:
          profile?.relationship_type ||
          contact.status ||
          "known_contact",
        calls_today: String(callsToday),
        returning_today: returningToday ? "true" : "false",

        company_name: contact.company || "",
        property_address: contact.address || "",
        project_type: contact.project_type || "",

        relationship_summary:
          profile?.relationship_summary || "",
        current_context:
          profile?.current_context || "",
        memory_summary:
          profile?.memory_summary || "",
        last_call_summary:
          profile?.last_call_summary ||
          contact.last_call_summary ||
          "",

        communication_preferences:
          profile?.communication_preferences || "",
      }),
    });
  } catch (err: any) {
    console.error("mya-call-start error:", err);
    return res.status(200).json(unknownCallerResponse());
  }
}
