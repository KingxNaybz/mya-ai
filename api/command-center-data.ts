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

const ACCESS_KEY = process.env.COMMAND_CENTER_KEY || "";

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-cc-key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const providedKey = req.headers["x-cc-key"] || req.query?.key || "";

  // These two cases are kept distinct (without ever revealing the actual
  // key value) so a connection problem can be diagnosed from the client:
  // "not_configured" means COMMAND_CENTER_KEY never reached this function
  // (env var missing/misnamed, or deployed before it was saved); "invalid_key"
  // means it's configured but what was typed doesn't match it.
  if (!ACCESS_KEY) {
    return res.status(401).json({ error: "Unauthorized", reason: "not_configured" });
  }
  if (providedKey !== ACCESS_KEY) {
    return res.status(401).json({ error: "Unauthorized", reason: "invalid_key" });
  }

  const todayIso = startOfTodayAtlanta();
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
    ]);

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      todaysCalls: {
        value: callsTodayCount.count ?? null,
        error: callsTodayCount.error?.message || null,
        recent: (recentCalls.data || []).map((c: any) => ({
          name: c.caller_name || c.caller_number || "Unknown caller",
          topic: c.caller_intent || "",
          outcome: c.call_outcome || "",
          time: c.created_at,
        })),
      },
      newLeads: {
        value: newLeadsCount.count ?? null,
        error: newLeadsCount.error?.message || null,
        recent: (recentLeads.data || []).map((l: any) => ({
          name: l.name || l.phone || "Unknown lead",
          interest: l.project_type || "",
          source: l.lead_source || "",
          receivedAt: l.last_contact_at,
        })),
      },
      recentActivity: [
        ...(recentCalls.data || []).map((c: any) => ({
          time: c.created_at,
          text: `${c.caller_name || c.caller_number || "Someone"} called${
            c.caller_intent ? ` about ${c.caller_intent}` : ""
          }.`,
        })),
        ...(recentIntakes.data || []).map((i: any) => ({
          time: i.created_at,
          text: `New project intake: ${i.full_name || "Unknown"}${
            i.project_type ? ` (${i.project_type})` : ""
          }.`,
        })),
      ]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 6),
      memoryInsights: {
        totalContactsRemembered: contactsCount.count ?? null,
        recurringCustomers: recurringCount.count ?? null,
        notesLoggedThisWeek: updatedThisWeekCount.count ?? null,
      },
    });
  } catch (err: any) {
    console.error("command-center-data error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
