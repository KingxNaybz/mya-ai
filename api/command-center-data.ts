import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { isCommandCenterAuthenticated, commandCenterAuthMethod } from "../lib/session";
import { hermesStatus, hindsightHealth, type SystemReport } from "../lib/integrations";
import {
  applyAgentReport, applyOwnerAction, agentInstructions, connectionState, rowFromSession, sessionFromRow,
  validateReport, emptySession, type ComputerEvent, type ComputerSession,
} from "../lib/computer";

/**
 * Requires a valid dashboard session cookie or COMMAND_CENTER_API_KEY (see
 * isCommandCenterAuthenticated in lib/session.ts) -- checked before any
 * Supabase query runs, so an unauthenticated request never touches the
 * database. Vercel's own Deployment Protection is not a substitute for this:
 * it does not reliably cover Production (confirmed directly against the
 * live deployment), so this endpoint must not depend on it.
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

// A first-time caller isn't automatically a real lead — a bill collector,
// vendor, or job applicant also generates a brand-new mya_contacts row on
// their first call. Cross-reference the separate Company Contacts
// classification (by phone) and only exclude someone confidently
// classified as something else. No classification found for a phone
// (feature just turned on, or outside the classification lookback window)
// still counts as a lead — never hide a possible real lead over a data gap.
const NOT_A_REAL_LEAD_CATEGORIES = new Set([
  "vendor",
  "contractor",
  "subcontractor",
  "general_contractor",
  "bill_collector",
  "job_applicant",
  "wrong_number_or_spam",
  "existing_client",
  "uncategorized",
]);

function isRealLead(phone: string | null | undefined, categoryByPhone: Map<string, string>): boolean {
  if (!phone) return true;
  const category = categoryByPhone.get(phone);
  return !category || !NOT_A_REAL_LEAD_CATEGORIES.has(category);
}

/* ── ?type=systems: real health for the Systems module ───────────
 * One status per system, only from signals we can actually verify:
 *   up / down         a real read-only check just ran
 *   configured        credentials present, not probed live (the check
 *                     would cost money or has no read-only endpoint)
 *   not_configured    credentials missing
 *   not_observable    no verified signal reaches the Command Center
 * External systems go through lib/integrations.ts (narrow, read-only,
 * timeouts, no secrets returned). Lives here rather than in a new file
 * because api/ is at Vercel Hobby's 12-function cap. */
async function lastActionAt(surface: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("mya_action_log")
      .select("created_at")
      .eq("requested_by", surface)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error || !data || !data[0]) return null;
    return data[0].created_at || null;
  } catch {
    return null;
  }
}

function configReport(id: string, name: string, configured: boolean, detail: string): SystemReport {
  return {
    id,
    name,
    status: configured ? "configured" : "not_configured",
    detail: configured ? detail : `${detail} — not configured.`,
    checkedAt: new Date().toISOString(),
    latencyMs: null,
  };
}

async function supabaseReport(): Promise<SystemReport> {
  const name = "Database (Supabase)";
  if (!SUPABASE_URL || !SUPABASE_KEY) return configReport("supabase", name, false, "Business data storage");
  const started = Date.now();
  try {
    const { error } = await supabase.from("mya_projects").select("id", { head: true }).limit(1);
    return {
      id: "supabase",
      name,
      status: error ? "down" : "up",
      detail: error ? "Database query failed." : "Business data storage — responding.",
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
    };
  } catch {
    return { id: "supabase", name, status: "down", detail: "Couldn't reach the database.", checkedAt: new Date().toISOString(), latencyMs: null };
  }
}

async function handleSystems(res: VercelResponse) {
  try {
    const env = process.env;
    const [supabaseR, hindsightR, mcpLast, desktopLast, computer] = await Promise.all([
      supabaseReport(),
      hindsightHealth(),
      lastActionAt("hermes_mcp"),
      lastActionAt("desktop_app"),
      readComputerSession().catch(() => null),
    ]);
    // Watch Mya heartbeat: a real signal once the agent reports.
    const heartbeat = computer && !computer.error ? computer.session.heartbeatAt : null;
    const agentConn = connectionState(heartbeat, Date.now());
    const mcpConfigured = env.MCP_BRIDGE_ENABLED === "true" && Boolean(env.MCP_BRIDGE_KEY);
    const systems: SystemReport[] = [
      supabaseR,
      configReport("anthropic", "Claude (background)", Boolean(env.ANTHROPIC_API_KEY), "Caller classification only. Not a Command Center assistant"),
      configReport("voice", "Mya's voice (ElevenLabs)", Boolean(env.ELEVENLABS_API_KEY && env.ELEVENLABS_VOICE_ID), "Spoken chat replies"),
      configReport("phone", "Phone system (Twilio)", Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER), "Calls and SMS"),
      ...hermesStatus(),
      hindsightR,
      {
        ...configReport("mcp", "Hermes MCP read bridge", mcpConfigured,
          "Read-only allowlist: get_project, get_client, search_projects"),
        lastActivityAt: mcpLast,
      },
      {
        id: "windows",
        name: "Windows agent",
        status: agentConn === "live" ? "up" : agentConn === "stale" ? "down" : "not_observable",
        detail: agentConn === "live" ? "Reporting to Watch Mya — heartbeat just now."
          : agentConn === "stale" ? "Its Watch Mya heartbeat stopped recently."
          : desktopLast
            ? "No live heartbeat — last seen when it last asked Mya something."
            : "No live heartbeat, and no activity recorded from it yet.",
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        lastActivityAt: heartbeat || desktopLast,
      },
      {
        id: "houzz",
        name: "Houzz Pro",
        status: "not_configured",
        detail: "No Houzz adapter in this phase.",
        checkedAt: new Date().toISOString(),
        latencyMs: null,
      },
    ];
    return res.status(200).json({ generatedAt: new Date().toISOString(), systems });
  } catch (err: any) {
    console.error("command-center-data GET systems error:", err);
    return res.status(500).json({ error: "Couldn't check systems." });
  }
}

/**
 * ?type=audit — the most recent entries of Mya's audit trail
 * (mya_action_log), read-only, for the Operations screen. Returns only what
 * the screen needs: tool, permission level, which surface asked, and the
 * outcome and time. The tool input is never returned. Attribution comes
 * from requested_by (the surface that made the call). model_provider is not
 * used, because the insert path (logActionEvent) still records "anthropic"
 * for every entry.
 */
const AUDIT_LIMIT = 25;

async function handleAudit(res: VercelResponse) {
  try {
    const { data, error } = await supabase
      .from("mya_action_log")
      .select("tool_name, permission_level, requested_by, result_summary, created_at")
      .order("created_at", { ascending: false })
      .limit(AUDIT_LIMIT);
    if (error) {
      console.error("command-center-data GET audit error:", error);
      return res.status(502).json({ error: "Couldn't read the audit log." });
    }
    return res.status(200).json({ entries: data || [], limit: AUDIT_LIMIT });
  } catch (err: any) {
    console.error("command-center-data GET audit error:", err);
    return res.status(500).json({ error: "Couldn't read the audit log." });
  }
}

/**
 * Watch Mya (?type=computer*) — see lib/computer.ts for the contract.
 *
 *   GET  ?type=computer          session + recent events (no frame)    browser or agent
 *   GET  ?type=computer-frame    the latest downscaled frame           browser
 *   POST ?type=computer-control  { action } pause|resume|take|return|stop   browser session ONLY
 *   POST ?type=computer-report   heartbeat/task/step/frame/events      Windows Agent key ONLY
 *
 * The Windows Agent keeps its existing outbound-only model: it calls this
 * API with its own COMMAND_CENTER_API_KEY and every report's response tells
 * it whether it may issue input. No port on the PC is ever opened.
 *
 * Races: an agent report never writes `control` except to yield it, and
 * that write is conditional, so an owner's Take Control / Pause / Stop that
 * lands between the agent's read and write can't be overwritten. Status is
 * likewise never written over a stopped task unless a new task starts.
 *
 * Storage: mya_computer_sessions (one row per device) and
 * mya_computer_events. Until those tables exist (see the proposed SQL in
 * agent-os/specs/2026-09-30-watch-mya/schema.sql), every call answers
 * 503 not_configured -- the Command Center says so instead of guessing.
 */
const COMPUTER_DEVICE = "windows";
const COMPUTER_EVENTS_LIMIT = 30;

function isMissingTable(error: any): boolean {
  return Boolean(error) && (error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(String(error.message || "")));
}

async function readComputerSession(withFrame = false): Promise<{ session: ComputerSession; frame?: string | null; missing: boolean; error: boolean }> {
  const cols = "device_id, device_name, task_id, task, app, step, status, control, control_changed_at, control_changed_by, approval_id, heartbeat_at, frame_at, started_at" + (withFrame ? ", frame" : "");
  const { data, error } = await supabase.from("mya_computer_sessions").select(cols).eq("device_id", COMPUTER_DEVICE).limit(1);
  if (error) return { session: emptySession(COMPUTER_DEVICE), missing: isMissingTable(error), error: true };
  const row: any = data && data[0];
  return { session: sessionFromRow(row, COMPUTER_DEVICE), frame: row ? row.frame ?? null : null, missing: false, error: false };
}

async function logComputerEvents(events: ComputerEvent[]) {
  if (!events.length) return;
  try {
    await supabase.from("mya_computer_events").insert(events.map((e) => ({
      device_id: COMPUTER_DEVICE, at: e.at, kind: e.kind, text: e.text, app: e.app ?? null, by: e.by,
    })));
  } catch (err) {
    console.error("computer events insert failed:", err); // best-effort, never blocks control
  }
}

function notConfigured(res: VercelResponse) {
  return res.status(503).json({ error: "not_configured", message: "Watch Mya's storage isn't set up yet." });
}

async function handleComputerGet(res: VercelResponse, frame: boolean) {
  const r = await readComputerSession(frame);
  if (r.missing) return notConfigured(res);
  if (r.error) return res.status(502).json({ error: "Couldn't read Mya's computer session." });
  if (frame) return res.status(200).json({ frame: r.frame || null, frameAt: r.session.frameAt });
  const { data: events } = await supabase
    .from("mya_computer_events")
    .select("at, kind, text, app, by")
    .eq("device_id", COMPUTER_DEVICE)
    .order("at", { ascending: false })
    .limit(COMPUTER_EVENTS_LIMIT);
  return res.status(200).json({
    generatedAt: new Date().toISOString(),
    session: r.session,
    connection: connectionState(r.session.heartbeatAt, Date.now()),
    events: events || [],
  });
}

async function handleComputerControl(req: VercelRequest, res: VercelResponse) {
  const action = (req.body || {}).action;
  const r = await readComputerSession();
  if (r.missing) return notConfigured(res);
  if (r.error) return res.status(502).json({ error: "Couldn't read Mya's computer session." });
  const nowIso = new Date().toISOString();
  const out = applyOwnerAction(r.session, action, nowIso);
  if (!out.ok) return res.status(409).json({ error: out.error });
  const { error } = await supabase.from("mya_computer_sessions").upsert(rowFromSession(out.session), { onConflict: "device_id" });
  if (error) return res.status(502).json({ error: "Couldn't change control. Nothing changed." });
  await logComputerEvents([out.event]);
  try {
    await supabase.from("mya_action_log").insert({
      tool_name: "computer_control_" + action, permission_level: 0, requested_by: "dashboard_direct_ui",
      input: { action }, result_summary: "success",
    });
  } catch { /* best-effort audit */ }
  return res.status(200).json({ session: out.session, connection: connectionState(out.session.heartbeatAt, Date.now()) });
}

async function handleComputerReport(req: VercelRequest, res: VercelResponse) {
  const v = validateReport(req.body);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const r = await readComputerSession();
  if (r.missing) return notConfigured(res);
  if (r.error) return res.status(502).json({ error: "Couldn't read the computer session." });
  const nowIso = new Date().toISOString();
  const next = applyAgentReport(r.session, v.report, nowIso);
  const newTask = next.taskId !== r.session.taskId;
  const table = supabase.from("mya_computer_sessions");

  // 1. Everything except control and status: always safe to write.
  const base: Record<string, unknown> = {
    device_id: COMPUTER_DEVICE, device_name: next.deviceName, task_id: next.taskId, task: next.task, app: next.app,
    step: next.step, approval_id: next.approvalId, heartbeat_at: next.heartbeatAt, frame_at: next.frameAt, started_at: next.startedAt,
  };
  if (v.report.frame) base.frame = v.report.frame;
  if (!r.session.heartbeatAt && !r.session.taskId && !r.session.controlChangedAt) {
    // First report ever: create the row, starting without control.
    const { error } = await table.upsert({ ...rowFromSession(emptySession(COMPUTER_DEVICE)), ...base }, { onConflict: "device_id", ignoreDuplicates: true });
    if (error) return res.status(502).json({ error: "Couldn't save the report." });
  }
  const { error: baseErr } = await supabase.from("mya_computer_sessions").update(base).eq("device_id", COMPUTER_DEVICE);
  if (baseErr) return res.status(502).json({ error: "Couldn't save the report." });

  // 2. Status: never over a stopped task, unless this report starts a new one.
  if (v.report.status !== undefined || newTask) {
    let q = supabase.from("mya_computer_sessions").update({ status: next.status }).eq("device_id", COMPUTER_DEVICE);
    if (!newTask) q = q.neq("status", "stopped");
    await q;
  }
  // 3. Control only ever becomes MORE restrictive here, and conditionally.
  if (newTask) {
    await supabase.from("mya_computer_sessions").update({ control: "paused", control_changed_at: nowIso, control_changed_by: "agent" })
      .eq("device_id", COMPUTER_DEVICE).eq("control", "mya");
  }
  if (v.report.control === "user") {
    await supabase.from("mya_computer_sessions").update({ control: "user", control_changed_at: nowIso, control_changed_by: "agent" })
      .eq("device_id", COMPUTER_DEVICE).neq("control", "user");
  }
  await logComputerEvents((v.report.events || []).map((e) => ({ at: nowIso, kind: e.kind, text: e.text, app: e.app ?? next.app, by: "mya" as const }))
    .concat(v.report.control === "user" && r.session.control !== "user"
      ? [{ at: nowIso, kind: "control" as const, text: "Mya saw you use the computer and handed you control.", app: next.app, by: "agent" as const }]
      : []));

  // The agent obeys what's stored NOW, not what it just sent.
  const after = await readComputerSession();
  return res.status(200).json(agentInstructions(after.error ? { ...next, control: "paused" } : after.session));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const type = req.query.type;
  const isComputerPost = req.method === "POST" && (type === "computer-control" || type === "computer-report");
  if (req.method !== "GET" && !isComputerPost) {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isCommandCenterAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (isComputerPost) {
    const method = commandCenterAuthMethod(req);
    // Control belongs to the owner's signed-in browser; reports belong to
    // the agent's key. Neither can do the other's job.
    if (type === "computer-control") {
      if (method !== "session") return res.status(403).json({ error: "Only the signed-in owner can change control." });
      return handleComputerControl(req, res);
    }
    if (method !== "api_key") return res.status(403).json({ error: "Only the Windows Agent reports computer activity." });
    return handleComputerReport(req, res);
  }
  if (type === "computer") return handleComputerGet(res, false);
  if (type === "computer-frame") {
    if (commandCenterAuthMethod(req) !== "session") return res.status(403).json({ error: "Frames are for the signed-in owner." });
    return handleComputerGet(res, true);
  }

  if (req.query.type === "systems") return handleSystems(res);
  if (req.query.type === "audit") return handleAudit(res);

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
      callerDirectoryRows,
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
        .select("id,phone")
        .eq("status", "new"),
      supabase
        .from("mya_contacts")
        .select("name,phone,project_type,lead_source,last_contact_at")
        .eq("status", "new")
        .order("last_contact_at", { ascending: false })
        .limit(20),
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
      supabase
        .from("mya_caller_classifications")
        .select("name,phone,email,website,company,category,flag_for_block,reasoning,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const categoryByPhone = new Map<string, string>(
      (callerDirectoryRows.data || [])
        .filter((c: any) => c.phone)
        .map((c: any) => [c.phone, c.category])
    );
    const realNewLeadRows = (newLeadsCount.data || []).filter((c: any) => isRealLead(c.phone, categoryByPhone));
    const realRecentLeads = (recentLeads.data || []).filter((l: any) => isRealLead(l.phone, categoryByPhone)).slice(0, 6);

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
        value: realNewLeadRows.length,
        error: newLeadsCount.error?.message || null,
        recent: realRecentLeads.map((l: any) => ({
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
      callerDirectory: (callerDirectoryRows.data || []).map((c: any) => ({
        name: cleanText(c.name, 80) || null,
        phone: c.phone || null,
        email: c.email || null,
        website: c.website || null,
        company: cleanText(c.company, 80) || null,
        category: c.category || "uncategorized",
        flagForBlock: Boolean(c.flag_for_block),
        reasoning: cleanText(c.reasoning, 300) || null,
        createdAt: c.created_at,
      })),
    });
  } catch (err: any) {
    console.error("command-center-data error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
