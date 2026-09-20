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
      return res.status(200).json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          known_caller: "false",
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
          important_notes: "",
          open_follow_ups: "",
        },
      });
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

      return res.status(200).json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          known_caller: "false",
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
          important_notes: "",
          open_follow_ups: "",
        },
      });
    }

    if (!contact) {
      return res.status(200).json({
        type: "conversation_initiation_client_data",
        dynamic_variables: {
          known_caller: "false",
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
          important_notes: "",
          open_follow_ups: "",
        },
      });
    }

    const { data: profile, error: profileErr } = await supabase
      .from("mya_customer_profiles")
      .select(
        "preferred_name,relationship_type,relationship_summary,current_context,memory_summary,communication_preferences,important_notes,open_follow_ups,last_call_at,calls_today,lifetime_calls,last_call_summary"
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

    const preferredName =
      profile?.preferred_name ||
      contact.name ||
      "";

    const greetingName =
      preferredName.trim().split(/\s+/)[0] || "";

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
      dynamic_variables: {
        known_caller: "true",
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
        important_notes:
          profile?.important_notes || "",
        open_follow_ups:
          profile?.open_follow_ups || "",
      },
    });
  } catch (err: any) {
    console.error("mya-call-start error:", err);

    return res.status(200).json({
      type: "conversation_initiation_client_data",
        dynamic_variables: {
          known_caller: "false",
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
          important_notes: "",
          open_follow_ups: "",
        },
    });
  }
}
