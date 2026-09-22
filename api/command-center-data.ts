import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * IMPORTANT: this endpoint has no password/key check of its own. It relies
 * entirely on Vercel's own "Deployment Protection" (a login screen Vercel
 * puts in front of the whole deployment, configured in the Vercel dashboard
 * under Settings) to keep it from being publicly reachable. If that ever
 * gets turned off for the environment this is deployed to — and especially
 * before this is ever merged to `main` / production — this endpoint would
 * return real customer data to anyone with the URL. Do not merge this to
 * main without either Vercel Deployment Protection covering Production too,
 * or a proper page-level login in front of the Command Center itself.
 */

/* ── env ─────────────────────────────────────────────────────── */
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** Start of "today" in America/New_York, as an ISO string, for date filtering. */
function startOfTodayAtlanta(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;

  // Atlanta is UTC-4 (EDT) or UTC-5 (EST); using -05:00 keeps the boundary
  // safely at or before local midnight in both cases for a "today" filter.
  return `${y}-${m}-${d}T00:00:00-05:00`;
}

function sevenDaysAgoIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

function startOfTomorrowAtlanta(): string {
  return new Date(new Date(startOfTodayAtlanta()).getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function todayDateString(): string {
  return startOfTodayAtlanta().slice(0, 10);
}

// Checks whether each integration is CONFIGURED, not whether it's live-
// reachable right now. Duplicated (not shared) from command-center-ask-mya.ts
// on purpose — Vercel's Hobby plan caps functions at 12, already maxed out
// by this project's file count, so no new file gets added for this.
function getServicesStatus() {
  return [
    {
      name: "Phone system (Twilio)",
      detail: "Inbound/outbound calling",
      connected: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
    },
    {
      name: "Voice (ElevenLabs)",
      detail: "Phone agent voice",
      connected: Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_AGENT_ID),
    },
    {
      name: "Database (Supabase)",
      detail: "Business data storage",
      connected: Boolean(SUPABASE_URL && SUPABASE_KEY),
    },
    {
      name: "Mya's brain (Anthropic)",
      detail: "Claude Sonnet 5",
      connected: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  ];
}

/**
 * Some ElevenLabs "collected data" fields (e.g. calls.caller_intent) can end
 * up stored as a raw internal object — { data_collection_id, json_schema,
 * value, rationale, ... } — instead of the plain sentence they're meant to
 * hold. This defensively pulls out just the readable text, whatever shape
 * the field actually is in, and always caps the length so a single odd row
 * can never blow up a card's layout.
 */
function cleanText(value: unknown, maxLen = 140): string {
  let text = "";

  if (typeof value === "string") {
    text = value;
  } else if (value && typeof value === "object" && typeof (value as any).value === "string") {
    text = (value as any).value;
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      text = typeof parsed?.value === "string" ? parsed.value : "";
    } catch {
      text = "";
    }
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxLen) text = text.slice(0, maxLen - 1) + "…";
  return text;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const todayIso = startOfTodayAtlanta();
  const tomorrowIso = startOfTomorrowAtlanta();
  const todayDate = todayDateString();
  const weekAgoIso = sevenDaysAgoIso();

  try {
    const [
      callsTodayCount,
      recentCalls,
      newLeadsCount,
      recentLeads,
      recentIntakes,
      contactsCount,
      recurringCount,
      updatedThisWeekCount,
      todaysAppointments,
      projectsDueToday,
      recentActions,
    ] = await Promise.all([
      supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayIso),
      supabase
        .from("calls")
        .select("caller_name,caller_number,caller_intent,call_outcome,created_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("mya_contacts")
        .select("id", { count: "exact", head: true })
        .eq("status", "new"),
      supabase
        .from("mya_contacts")
        .select("name,phone,project_type,lead_source,last_contact_at")
        .eq("status", "new")
        .order("last_contact_at", { ascending: false })
        .limit(6),
      supabase
        .from("mya_intakes")
        .select("full_name,project_type,lead_source,created_at")
        .order("created_at", { ascending: false })
        .limit(6),
      supabase
        .from("mya_contacts")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("mya_customer_profiles")
        .select("id", { count: "exact", head: true })
        .gt("lifetime_calls", 1),
      supabase
        .from("mya_customer_profiles")
        .select("id", { count: "exact", head: true })
        .gte("updated_at", weekAgoIso),
      supabase
        .from("mya_appointments")
        .select("title,scheduled_at,notes")
        .gte("scheduled_at", todayIso)
        .lt("scheduled_at", tomorrowIso)
        .order("scheduled_at"),
      supabase
        .from("mya_projects")
        .select("project_name,client_name,next_action")
        .eq("next_action_due", todayDate),
      supabase
        .from("mya_undo_log")
        .select("description,created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      todaysCalls: {
        value: callsTodayCount.count ?? null,
        error: callsTodayCount.error?.message || null,
        recent: (recentCalls.data || []).map((c: any) => ({
          name: cleanText(c.caller_name, 60) || c.caller_number || "Unknown caller",
          topic: cleanText(c.caller_intent, 100),
          outcome: cleanText(c.call_outcome, 40),
          time: c.created_at,
        })),
      },
      newLeads: {
        value: newLeadsCount.count ?? null,
        error: newLeadsCount.error?.message || null,
        recent: (recentLeads.data || []).map((l: any) => ({
          name: cleanText(l.name, 60) || l.phone || "Unknown lead",
          interest: cleanText(l.project_type, 60),
          source: cleanText(l.lead_source, 40),
          receivedAt: l.last_contact_at,
        })),
      },
      recentActivity: [
        ...(recentCalls.data || []).map((c: any) => {
          const intent = cleanText(c.caller_intent, 100);
          const who = cleanText(c.caller_name, 60) || c.caller_number || "Someone";
          return {
            time: c.created_at,
            text: `${who} called${intent ? ` about ${intent}` : ""}.`,
          };
        }),
        ...(recentIntakes.data || []).map((i: any) => {
          const name = cleanText(i.full_name, 60) || "Unknown";
          const projectType = cleanText(i.project_type, 60);
          return {
            time: i.created_at,
            text: `New project intake: ${name}${projectType ? ` (${projectType})` : ""}.`,
          };
        }),
      ]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 6),
      memoryInsights: {
        totalContactsRemembered: contactsCount.count ?? null,
        recurringCustomers: recurringCount.count ?? null,
        notesLoggedThisWeek: updatedThisWeekCount.count ?? null,
      },
      schedule: [
        ...(todaysAppointments.data || []).map((a: any) => ({
          time: new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeStyle: "short" }).format(new Date(a.scheduled_at)),
          label: a.title,
        })),
        ...(projectsDueToday.data || []).map((p: any) => ({
          time: "Today",
          label: `${cleanText(p.next_action, 100) || "Next action due"} — ${cleanText(p.project_name, 60) || cleanText(p.client_name, 60)}`,
        })),
      ],
      workingNow: (recentActions.data || []).map((r: any) => r.description),
      services: getServicesStatus(),
    });
  } catch (err: any) {
    console.error("command-center-data error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
