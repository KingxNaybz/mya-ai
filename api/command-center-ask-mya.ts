import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to. This one
 * lets Mya WRITE (add/remove contractors, create follow-ups, resolve
 * approvals) on the owner's behalf via natural language, so it is the most
 * consequential endpoint in the Command Center. Do not merge to main
 * without Deployment Protection covering Production too, or a proper
 * page-level login in front of the Command Center.
 *
 * This calls the Anthropic API directly with plain fetch (no SDK dependency
 * added to package.json, by explicit request). Requires an ANTHROPIC_API_KEY
 * env var set in Vercel — never read or logged here beyond passing it in the
 * request header.
 *
 * SKILL REGISTRY: every capability Mya has is one entry in SKILLS below —
 * name, description, input schema, and the function that runs it. This is
 * the single source of truth: the tool list sent to Claude, the dispatcher
 * that executes a tool call, and the list_capabilities skill (Mya's
 * "runtime self-knowledge" — what it can do, read live from this array
 * rather than a hardcoded description that can drift out of date) are all
 * derived from it. Adding a new capability means adding one entry here.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = "claude-sonnet-5";
const MAX_TOOL_ITERATIONS = 5;

// Checks whether each integration is CONFIGURED (required env vars present),
// not whether it's actually reachable right now — a live ping on every
// dashboard load/chat message would add latency and cost for little real
// benefit. Duplicated (not shared) in command-center-data.ts on purpose:
// Vercel's Hobby plan caps serverless functions at 12, already maxed out by
// this project's file count, so no new files get added for a small helper.
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
      connected: Boolean(ANTHROPIC_API_KEY),
    },
  ];
}

// Same ElevenLabs key the phone system (outbound-call.ts) already uses.
// ELEVENLABS_VOICE_ID is new — the Voice ID of the Conversational AI agent
// callers hear, from ElevenLabs' dashboard, so dashboard replies can be
// spoken in the same voice. Both are optional: if either is missing, voice
// replies are silently skipped and the dashboard just shows text as before.
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "";

// A first-time caller isn't automatically a real lead — a bill collector,
// vendor, or job applicant also generates a brand-new mya_contacts row on
// their first call. Cross-reference the separate Company Contacts
// classification (by phone) and only exclude someone confidently
// classified as something else. No classification found for a phone
// (feature just turned on, or outside the classification lookback window)
// still counts as a lead — never hide a possible real lead over a data gap.
// Duplicated from command-center-data.ts on purpose, same reason as
// getServicesStatus above.
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

// Every category Company Contacts sorts a caller into. Duplicated from
// mya-call-ended.ts on purpose, same reason as getServicesStatus above.
const CALLER_CATEGORIES = [
  "lead",
  "existing_client",
  "vendor",
  "contractor",
  "subcontractor",
  "general_contractor",
  "bill_collector",
  "job_applicant",
  "wrong_number_or_spam",
  "uncategorized",
];

async function getCategoryByPhoneMap(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("mya_caller_classifications")
    .select("phone,category")
    .order("created_at", { ascending: false })
    .limit(500);
  return new Map((data || []).filter((c: any) => c.phone).map((c: any) => [c.phone, c.category]));
}

/* ── Backfilling classification for calls that happened before Company
   Contacts existed (or before its setup was finished) ─────────────────
   Reuses the same categories/logic as the live call-ending classifier in
   mya-call-ended.ts, adapted to work off the already-saved flat transcript
   text (calls.transcript) instead of the live ElevenLabs event, since
   that's all a past call has on file. Duplicated rather than shared, same
   reason as getServicesStatus above — plus mya-call-ended.ts is a
   protected file this project never edits except for its one already-made
   isolated addition. */
const BILL_COLLECTOR_PHRASE =
  /attempt(?:ing)?\s+to\s+collect\s+(?:a|this|the)\s+debt|this\s+(?:call|communication)\s+is\s+from\s+a\s+debt\s+collector/i;

/** Pulls just the caller's own lines out of the "Mya: ...\nCaller: ..." flat
 * transcript text saved on the calls table. */
function callerLinesFromTranscript(transcriptText: string): string {
  return (transcriptText || "")
    .split("\n")
    .filter((line) => line.startsWith("Caller:"))
    .join(" ");
}

function extractEmailFromTranscript(transcriptText: string): string | null {
  const callerText = callerLinesFromTranscript(transcriptText);
  const match = callerText.match(/[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

function extractWebsiteFromTranscript(transcriptText: string): string | null {
  const callerText = callerLinesFromTranscript(transcriptText);
  const candidates = callerText.matchAll(
    /\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:com|net|org|io|co|biz)\b(?:\/[^\s]*)?/gi
  );
  for (const m of candidates) {
    if (callerText[m.index! - 1] === "@") continue;
    return m[0];
  }
  return null;
}

async function classifyTranscriptWithAI(transcriptText: string): Promise<{ category: string; reasoning: string } | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const prompt =
      `A phone call happened at a construction company. Read the transcript and ` +
      `classify who the caller was.\n\n` +
      `Categories (pick exactly one): ${CALLER_CATEGORIES.filter((c) => c !== "uncategorized").join(", ")}\n\n` +
      `Transcript:\n${transcriptText.slice(0, 6000)}\n\n` +
      `Respond with ONLY this JSON shape, nothing else: {"category": "...", "reasoning": "one short sentence"}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 150,
        output_config: { effort: "low" },
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).find((b: any) => b.type === "text")?.text || "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const category = CALLER_CATEGORIES.includes(parsed.category) ? parsed.category : "uncategorized";
    return {
      category,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : "",
    };
  } catch (err) {
    console.error("Backfill classification AI error (non-fatal):", err);
    return null;
  }
}

const SYSTEM_PROMPT = `You are Mya, an AI operations assistant embedded in a dashboard for Elevate Construction, a construction company. The owner (Michael) talks to you here to check on the business and to make real changes using the tools you're given.

Rules:
- Only call a tool when the request actually needs an action or a lookup. For small talk or things no tool covers, just reply normally.
- If a lookup tool (e.g. removing or approving something by name) returns more than one match, do not guess — list the matches in your reply and ask which one they mean.
- If a tool returns zero matches, say so plainly rather than assuming.
- After taking an action, confirm in one short sentence what you did.
- If asked what you can do, what your capabilities are, or what you can't do yet, call list_capabilities rather than describing yourself from memory — that list is the real, current one.
- If the user says "undo", "undo that", or asks to reverse the last thing you did, call undo_last_action. Don't guess which action they mean — that skill always reverses the single most recent reversible action.
- If the user tells you to remember something, or shares a fact/preference/detail worth keeping for later ("remember that...", "the Rivers project needs..."), call remember_fact. If asked what you remember or know about something, call recall_memory rather than guessing.
- Projects are the company's real jobs (e.g. "3941 Briar Glen Ct" / "Courtney Vonwalsung"). When asked about a specific project, call get_project rather than guessing at details — it returns everything on file for that job. Use create_project when a new job should be tracked, update_project to record scope/status/pricing/decision changes, and list_projects to see what's open or in a given status.
- The Company Brain holds standing business info (margin targets, payment terms, warranty language, estimating standards, insurance procedures, lessons learned) — call get_company_brain when asked about company policy/standards, and update_company_brain when told to change one.
- Estimates are built from real cost line items, never guessed. Use add_estimate_item to log a real quantity x rate cost against a project, calculate_estimate to get its Direct Cost/True Cost/Floor Price/Target Price, and evaluate_bid_price for "what if we bid this at $X" questions. If a project has no line items yet, say so and offer to log some — never invent a price.
- Keep replies brief and conversational — this can be read out loud or read at a glance on a dashboard, not a report.
- You DO have a voice: replies can be spoken aloud in the same voice as the phone system, and there's an always-listen mic that wakes on your name. Neither is a tool you call — they run automatically in the dashboard. If asked whether you can talk or listen, say yes (unless list_capabilities' note says otherwise), don't claim you're text-only.
- New leads (list_leads), recent activity (list_recent_activity), and aggregate memory stats (get_memory_insights, different from your own remembered facts) are all real, live tools — use them rather than only citing the count from get_dashboard_summary. "New Leads" only counts real prospective customers — vendors, bill collectors, job applicants, and other non-leads are filtered out and show up in Company Contacts instead.
- Today's Schedule is real: use create_appointment for a site visit/walkthrough/meeting at a specific date+time, and list_schedule to see today's appointments plus any project whose next action is due today (set via update_project's nextActionDue).
- get_recent_actions and get_services_status are also real, live tools now, matching the "Mya Working Now" and "Connected Services" dashboard panels. get_services_status checks whether each integration is configured, not whether it's live-reachable right now — say so if asked to be precise.
- After every real phone call ends, it's automatically sorted into Company Contacts (a separate list from "New Leads," opened from its own nav item, not shown inline on the dashboard) as a lead, existing client, vendor, contractor, subcontractor, general contractor, bill collector, job applicant, wrong number/spam, or uncategorized. Bill collectors get flagged there but nothing is actually blocked yet — that's a manual step the owner does himself, later. Use list_caller_directory to answer questions about who's called (optionally filtered by category), and call open_contact_directory when asked to "pull up the contact spreadsheet," "show me company contacts," or similar — the dashboard itself handles opening that view and offering the Excel download. If told a caller was sorted into the wrong category, call reclassify_caller — same disambiguation rule as everything else: if the name/phone matches more than one caller, list them and ask which one instead of guessing. If asked about a past call/caller that isn't showing up in Company Contacts (it only auto-classifies calls that ended after this feature went live), call backfill_caller_classifications to go classify older calls on file — it's always safe to run, since it skips anything already classified.
- Devices is the one dashboard panel still placeholder sample data with no tool behind it. If asked about it, say plainly you don't have that connected yet — never invent a plausible-sounding status to sound complete.`;

/**
 * UNDO: reversible skills log how to reverse themselves to mya_undo_log
 * (a Supabase table) right after they succeed. Serverless functions have no
 * memory between requests, so this log — not an in-memory stack — is what
 * makes "undo that" work even a few requests later. undo_last_action always
 * reverses the single most recent not-yet-undone entry.
 */
async function logUndo(actionType: string, undoData: any, description: string): Promise<void> {
  await supabase.from("mya_undo_log").insert({
    action_type: actionType,
    undo_data: undoData,
    description,
    undone: false,
  });
}

/**
 * PERMISSION LEVELS (0=READ, 1=PREPARE, 2=ACT, 3=APPROVAL REQUIRED, 4=OWNER
 * ONLY) — classification only, for the audit log below. Nothing here blocks
 * a skill from running; every skill still behaves exactly as it does today.
 * Gating specific levels behind an actual approval step is a deliberate,
 * separate, later change, not something this classification does on its own.
 *
 * Only exceptions to the "get_/list_/calculate_/evaluate_/recall_ = read"
 * naming convention need an entry here — everything else defaults to level 2
 * (an already-undoable action, matching every write-capable skill's existing
 * logUndo() call) unless listed.
 */
const PERMISSION_OVERRIDES: Record<string, number> = {
  open_contact_directory: 0, // signals the dashboard to open a view — never writes
  update_company_brain: 3, // margin targets, contract language — real business consequence
};
const READ_PREFIXES = ["get_", "list_", "calculate_", "evaluate_", "recall_"];

function getPermissionLevel(skillName: string): number {
  if (skillName in PERMISSION_OVERRIDES) return PERMISSION_OVERRIDES[skillName];
  return READ_PREFIXES.some((p) => skillName.startsWith(p)) ? 0 : 2;
}

/**
 * mya_action_log: a full audit trail (tool, permission level, which model,
 * what was asked, success/error, when) for every tool call Mya makes, read
 * or write — a superset of mya_undo_log, which only ever needed to track
 * reversible writes for "undo that." Best-effort and strictly non-blocking:
 * same pattern as synthesizeSpeech below — an audit-log failure (e.g. the
 * table not existing yet) must never break the actual reply.
 */
async function logActionEvent(params: {
  toolName: string;
  input: any;
  result: any;
  surface: string;
}): Promise<void> {
  try {
    const success = !(params.result && typeof params.result === "object" && "error" in params.result);
    await supabase.from("mya_action_log").insert({
      tool_name: params.toolName,
      permission_level: getPermissionLevel(params.toolName),
      model_provider: "anthropic",
      model_name: ANTHROPIC_MODEL,
      requested_by: params.surface,
      input: params.input,
      result_summary: success ? "success" : "error",
    });
  } catch (err) {
    console.error("Action log write failed (non-fatal):", err);
  }
}

type Skill = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: any) => Promise<any>;
};

/** Shared project lookup for the estimating skills — same
 * find-one-or-return-matches pattern used by get_project/update_project. */
async function findOneProject(
  query: string,
  columns: string
): Promise<{ project?: any; error?: string; matches?: any[] }> {
  const { data: matches, error } = await supabase
    .from("mya_projects")
    .select(columns)
    .or(`project_name.ilike.%${query}%,client_name.ilike.%${query}%`);
  if (error) return { error: error.message };
  if (!matches || matches.length === 0) return { error: "No project found matching that." };
  if (matches.length > 1) {
    return { matches: matches.map((m: any) => ({ id: m.id, project_name: m.project_name, client_name: m.client_name })) };
  }
  return { project: matches[0] };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function startOfTodayIso(): Promise<string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}T00:00:00-05:00`;
}

async function startOfTomorrowIso(): Promise<string> {
  const start = new Date(await startOfTodayIso());
  return new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

async function todayDateString(): Promise<string> {
  return (await startOfTodayIso()).slice(0, 10);
}

const SKILLS: Skill[] = [
  {
    name: "list_capabilities",
    description: "List everything Mya can currently do (and, by omission, what she can't). Use this when asked what you can do rather than describing yourself from memory.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({
      capabilities: SKILLS.filter((s) => s.name !== "list_capabilities").map((s) => ({
        name: s.name,
        description: s.description,
      })),
      note: "Anything not in this list — e.g. controlling this computer, taking screenshots, or placing phone calls — is not wired up yet. Voice is separate from this tool list: replies can be spoken out loud in the same voice as the phone system, and there's an always-listen mic that wakes on the word \"Mya\" — both are built into the dashboard itself, not callable tools.",
    }),
  },
  {
    name: "get_dashboard_summary",
    description: "Get a quick snapshot of today's business: calls today, new leads, open follow-ups, and pending approvals.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const todayIso = await startOfTodayIso();
      const [calls, leadRows, followups, approvals, categoryByPhone] = await Promise.all([
        supabase.from("calls").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
        supabase.from("mya_contacts").select("id,phone").eq("status", "new"),
        supabase.from("mya_followups").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("mya_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
        getCategoryByPhoneMap(),
      ]);
      const realLeadCount = (leadRows.data || []).filter((c: any) => isRealLead(c.phone, categoryByPhone)).length;
      return {
        callsToday: calls.count ?? 0,
        newLeads: realLeadCount,
        openFollowUps: followups.count ?? 0,
        pendingApprovals: approvals.count ?? 0,
      };
    },
  },
  {
    name: "list_leads",
    description: "List new leads with detail — name, what they're interested in, and how they found us. Same data the 'New Leads' dashboard panel shows. Vendors, bill collectors, job applicants, and other non-leads are excluded — use list_caller_directory for those.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const [{ data, error }, categoryByPhone] = await Promise.all([
        supabase
          .from("mya_contacts")
          .select("name,phone,project_type,lead_source,last_contact_at")
          .eq("status", "new")
          .order("last_contact_at", { ascending: false })
          .limit(50),
        getCategoryByPhoneMap(),
      ]);
      if (error) return { error: error.message };
      const realLeads = (data || []).filter((l: any) => isRealLead(l.phone, categoryByPhone)).slice(0, 20);
      return { leads: realLeads };
    },
  },
  {
    name: "list_recent_activity",
    description: "List the most recent business activity — recent calls and new project intakes, most recent first. Same data the 'Recent Activity' dashboard panel shows.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const [calls, intakes] = await Promise.all([
        supabase.from("calls").select("caller_name,caller_number,caller_intent,call_outcome,created_at").order("created_at", { ascending: false }).limit(10),
        supabase.from("mya_intakes").select("full_name,project_type,lead_source,created_at").order("created_at", { ascending: false }).limit(10),
      ]);
      const activity = [
        ...(calls.data || []).map((c: any) => ({
          time: c.created_at,
          text: `${c.caller_name || c.caller_number || "Someone"} called${c.caller_intent ? ` about ${c.caller_intent}` : ""}.`,
        })),
        ...(intakes.data || []).map((i: any) => ({
          time: i.created_at,
          text: `New project intake: ${i.full_name || "Unknown"}${i.project_type ? ` (${i.project_type})` : ""}.`,
        })),
      ]
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 10);
      return { activity };
    },
  },
  {
    name: "get_memory_insights",
    description: "Get aggregate customer-memory stats: total contacts remembered, how many are recurring customers, and how many notes were logged this week. Same data the 'Memory Insights' dashboard panel shows.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [contacts, recurring, updatedThisWeek] = await Promise.all([
        supabase.from("mya_contacts").select("id", { count: "exact", head: true }),
        supabase.from("mya_customer_profiles").select("id", { count: "exact", head: true }).gt("lifetime_calls", 1),
        supabase.from("mya_customer_profiles").select("id", { count: "exact", head: true }).gte("updated_at", weekAgoIso),
      ]);
      return {
        totalContactsRemembered: contacts.count ?? 0,
        recurringCustomers: recurring.count ?? 0,
        notesLoggedThisWeek: updatedThisWeek.count ?? 0,
      };
    },
  },
  {
    name: "get_recent_actions",
    description: "List the real actions you've recently taken (added a contractor, resolved an approval, updated a project, etc.). Same data the 'Mya Working Now' dashboard panel shows.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const { data, error } = await supabase
        .from("mya_undo_log")
        .select("description,created_at")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) return { error: error.message };
      return { recentActions: (data || []).map((r: any) => r.description) };
    },
  },
  {
    name: "get_services_status",
    description: "Check whether the connected services (phone system, voice, database, AI) are configured. Same data the 'Connected Services' dashboard panel shows. This checks configuration, not live reachability.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({ services: getServicesStatus() }),
  },
  {
    name: "list_caller_directory",
    description: "List callers Mya has automatically classified after their call ended — leads, existing clients, vendors, contractors, subcontractors, general contractors, bill collectors, job applicants, wrong numbers/spam, etc. Optionally filter by category. Same data the 'Company Contacts' view shows. Bill collectors are flagged for blocking here but nothing is actually blocked yet — that's a manual step the owner does separately.",
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional exact category filter, e.g. 'vendor', 'bill_collector', 'subcontractor', 'job_applicant'.",
        },
      },
      additionalProperties: false,
    },
    execute: async (input) => {
      let query = supabase
        .from("mya_caller_classifications")
        .select("name,phone,email,website,company,category,flag_for_block,reasoning,created_at")
        .order("created_at", { ascending: false });
      if (input.category) query = query.eq("category", input.category);
      const { data, error } = await query.limit(100);
      if (error) return { error: error.message };
      return { callers: data || [] };
    },
  },
  {
    name: "open_contact_directory",
    description: "Open/pull up the Company Contacts spreadsheet view in the dashboard — use this when asked to 'pull up the contact spreadsheet', 'show me company contacts', 'open the contacts list', or similar. The dashboard itself handles actually displaying it and offering the Excel download; this just signals that intent.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => ({ opened: true }),
  },
  {
    name: "reclassify_caller",
    description: "Manually correct which Company Contacts category a caller was sorted into — use this when told a caller was misclassified (e.g. \"move John Smith to vendors\" or \"that wasn't a bill collector, that was a real lead\"). Look up by name or phone; if more than one caller matches, list the matches and ask which one rather than guessing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The caller's name or phone number to find." },
        category: {
          type: "string",
          description: "The correct category to move them to.",
          enum: CALLER_CATEGORIES,
        },
      },
      required: ["query", "category"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const query = String(input.query || "").trim();
      const category = String(input.category || "").trim();
      if (!query) return { error: "Need a name or phone number to look up." };
      if (!CALLER_CATEGORIES.includes(category)) return { error: `Unknown category "${category}".` };

      const { data: matches, error } = await supabase
        .from("mya_caller_classifications")
        .select("id,name,phone,category")
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%`);
      if (error) return { error: error.message };
      if (!matches || matches.length === 0) return { error: `No caller found matching "${query}".` };
      if (matches.length > 1) {
        return { matches: matches.map((m: any) => ({ id: m.id, name: m.name, phone: m.phone, category: m.category })) };
      }

      const match = matches[0] as any;
      const previousCategory = match.category;
      const previousFlagForBlock = previousCategory === "bill_collector";
      const flagForBlock = category === "bill_collector";

      const { error: updateErr } = await supabase
        .from("mya_caller_classifications")
        .update({ category, flag_for_block: flagForBlock })
        .eq("id", match.id);
      if (updateErr) return { error: updateErr.message };

      await logUndo(
        "reclassify_caller",
        { id: match.id, previousCategory, previousFlagForBlock },
        `Reclassified ${match.name || match.phone || "a caller"} from ${previousCategory} to ${category}`
      );

      return { reclassified: true, name: match.name || null, phone: match.phone || null, from: previousCategory, to: category };
    },
  },
  {
    name: "backfill_caller_classifications",
    description: "Go back through past calls that happened before Company Contacts existed (or before it was fully set up) and classify them retroactively — lead, vendor, bill collector, etc., same categories new calls get automatically. Use this when asked to sort/classify old or past calls, or when a specific past caller (e.g. a name mentioned in an earlier call) isn't showing up in Company Contacts yet. Only processes calls that don't already have a classification, so it's always safe to run again — it never redoes work or double-bills.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of past calls to classify in this run (default 25) — kept modest so one request stays fast and cheap. Run again to process more.",
        },
      },
      additionalProperties: false,
    },
    execute: async (input) => {
      const limit = Math.min(Math.max(Number(input.limit) || 25, 1), 100);

      const { data: calls, error } = await supabase
        .from("calls")
        .select("conversation_id,caller_number,caller_name,transcript,created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) return { error: error.message };

      const candidateCalls = (calls || []).filter((c: any) => c.conversation_id);
      if (candidateCalls.length === 0) return { processed: 0, remaining: 0, message: "No past calls on file." };

      const { data: already, error: alreadyErr } = await supabase
        .from("mya_caller_classifications")
        .select("conversation_id")
        .in("conversation_id", candidateCalls.map((c: any) => c.conversation_id));
      if (alreadyErr) return { error: alreadyErr.message };

      const alreadyDone = new Set((already || []).map((a: any) => a.conversation_id));
      const unclassified = candidateCalls.filter((c: any) => !alreadyDone.has(c.conversation_id));
      if (unclassified.length === 0) {
        return { processed: 0, remaining: 0, message: "Everything on file is already classified — nothing left to backfill." };
      }

      const toProcess = unclassified.slice(0, limit);
      const results: any[] = [];

      for (const call of toProcess) {
        const transcriptText = call.transcript || "";
        const isBillCollector = BILL_COLLECTOR_PHRASE.test(transcriptText);
        let category = "uncategorized";
        let reasoning = "";

        if (isBillCollector) {
          category = "bill_collector";
          reasoning = "Caller stated this was an attempt to collect a debt (required by law for debt collectors).";
        } else {
          const aiResult = await classifyTranscriptWithAI(transcriptText);
          if (aiResult) {
            category = aiResult.category;
            reasoning = aiResult.reasoning;
          }
        }

        const { error: insertErr } = await supabase.from("mya_caller_classifications").insert({
          conversation_id: call.conversation_id,
          phone: call.caller_number || null,
          name: call.caller_name || null,
          email: extractEmailFromTranscript(transcriptText),
          website: extractWebsiteFromTranscript(transcriptText),
          category,
          flag_for_block: category === "bill_collector",
          reasoning,
        });
        if (insertErr) {
          console.error("Backfill insert error (non-fatal):", insertErr);
          continue;
        }
        results.push({ name: call.caller_name || null, phone: call.caller_number || null, category });
      }

      return {
        processed: results.length,
        remaining: unclassified.length - results.length,
        results,
      };
    },
  },
  {
    name: "list_contractors",
    description: "List contractors/sub-contractors, optionally filtered by category (e.g. 'Roofing', 'Electrician').",
    input_schema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional category filter" } },
      additionalProperties: false,
    },
    execute: async (input) => {
      let query = supabase.from("mya_contractors").select("id,category,name,phone,pricing_rate,notes").order("name");
      if (input.category) query = query.ilike("category", `%${input.category}%`);
      const { data, error } = await query.limit(25);
      if (error) return { error: error.message };
      return { contractors: data || [] };
    },
  },
  {
    name: "add_contractor",
    description: "Add a new contractor or sub-contractor to the list.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Trade/category, e.g. 'Roofing', 'Electrician'" },
        name: { type: "string", description: "Contact name or company" },
        phone: { type: "string" },
        pricingRate: { type: "string", description: "e.g. 'By the Job', '$75/Sq'" },
        notes: { type: "string" },
      },
      required: ["category", "name"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data, error } = await supabase
        .from("mya_contractors")
        .insert({
          category: String(input.category || "").trim(),
          name: String(input.name || "").trim(),
          phone: input.phone ? String(input.phone).trim() : null,
          pricing_rate: input.pricingRate ? String(input.pricingRate).trim() : null,
          notes: input.notes ? String(input.notes).trim() : null,
          added_in_crm: false,
        })
        .select("id,category,name")
        .single();
      if (error) return { error: error.message };
      if (data) {
        await logUndo("add_contractor", { id: data.id }, `Added contractor ${data.name}`);
      }
      return { added: data };
    },
  },
  {
    name: "remove_contractor",
    description: "Remove a contractor/sub-contractor by name. If more than one contractor matches, this returns the matches instead of deleting anything.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Name (or partial name) to search for" } },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data: matches, error: findError } = await supabase
        .from("mya_contractors")
        .select("id,category,name,phone,pricing_rate,notes,added_in_crm")
        .ilike("name", `%${input.name}%`);
      if (findError) return { error: findError.message };
      if (!matches || matches.length === 0) {
        return { removed: false, reason: "No contractor found matching that name." };
      }
      if (matches.length > 1) {
        return { removed: false, matches };
      }
      const { error: deleteError } = await supabase.from("mya_contractors").delete().eq("id", matches[0].id);
      if (deleteError) return { error: deleteError.message };
      await logUndo("remove_contractor", { contractor: matches[0] }, `Removed contractor ${matches[0].name}`);
      return { removed: true, contractor: matches[0] };
    },
  },
  {
    name: "create_followup",
    description: "Create a follow-up task for a customer.",
    input_schema: {
      type: "object",
      properties: {
        customerName: { type: "string" },
        note: { type: "string" },
        dueAt: { type: "string", description: "ISO date, optional" },
      },
      required: ["customerName"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data, error } = await supabase
        .from("mya_followups")
        .insert({
          customer_name: String(input.customerName || "").trim(),
          note: input.note ? String(input.note).trim() : null,
          due_at: input.dueAt || null,
          status: "open",
        })
        .select("id,customer_name")
        .single();
      if (error) return { error: error.message };
      if (data) {
        await logUndo("create_followup", { id: data.id }, `Created follow-up for ${data.customer_name}`);
      }
      return { created: data };
    },
  },
  {
    name: "list_pending_approvals",
    description: "List items currently pending the owner's approval.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const { data, error } = await supabase
        .from("mya_approvals")
        .select("id,title,detail,requested_at")
        .eq("status", "pending")
        .order("requested_at", { ascending: false })
        .limit(10);
      if (error) return { error: error.message };
      return { approvals: data || [] };
    },
  },
  {
    name: "resolve_approval",
    description: "Approve or decline a pending approval by matching its title. If more than one approval matches, this returns the matches instead of resolving anything.",
    input_schema: {
      type: "object",
      properties: {
        titleQuery: { type: "string", description: "Text to search for in the approval's title" },
        action: { type: "string", enum: ["approve", "decline"] },
      },
      required: ["titleQuery", "action"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data: matches, error: findError } = await supabase
        .from("mya_approvals")
        .select("id,title,action_type")
        .eq("status", "pending")
        .ilike("title", `%${input.titleQuery}%`);
      if (findError) return { error: findError.message };
      if (!matches || matches.length === 0) {
        return { resolved: false, reason: "No pending approval found matching that." };
      }
      if (matches.length > 1) {
        return { resolved: false, matches };
      }
      const status = input.action === "approve" ? "approved" : "declined";
      const { error: updateError } = await supabase
        .from("mya_approvals")
        .update({ status, resolved_at: new Date().toISOString() })
        .eq("id", matches[0].id)
        .eq("status", "pending");
      if (updateError) return { error: updateError.message };
      await logUndo(
        "resolve_approval",
        { id: matches[0].id },
        `${status === "approved" ? "Approved" : "Declined"} "${matches[0].title}"`
      );
      return { resolved: true, title: matches[0].title, status };
    },
  },
  {
    name: "undo_last_action",
    description: "Reverse the single most recent reversible action Mya took (adding/removing a contractor, creating a follow-up, or resolving an approval). Call this when the user says \"undo\" or asks to take back the last thing you did.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const { data: entry, error: findError } = await supabase
        .from("mya_undo_log")
        .select("id,action_type,undo_data,description")
        .eq("undone", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (findError) return { error: findError.message };
      if (!entry) return { undone: false, reason: "There's nothing to undo." };

      const undoData = entry.undo_data as any;
      let undoError: string | null = null;

      switch (entry.action_type) {
        case "add_contractor": {
          const { error } = await supabase.from("mya_contractors").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "remove_contractor": {
          const c = undoData.contractor;
          const { error } = await supabase.from("mya_contractors").insert({
            id: c.id,
            category: c.category,
            name: c.name,
            phone: c.phone,
            pricing_rate: c.pricing_rate,
            notes: c.notes,
            added_in_crm: c.added_in_crm,
          });
          if (error) undoError = error.message;
          break;
        }
        case "create_followup": {
          const { error } = await supabase.from("mya_followups").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "resolve_approval": {
          const { error } = await supabase
            .from("mya_approvals")
            .update({ status: "pending", resolved_at: null })
            .eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "remember_fact": {
          const { error } = await supabase.from("mya_remembered_facts").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "create_project": {
          const { error } = await supabase.from("mya_projects").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "update_project": {
          const { error } = await supabase.from("mya_projects").update(undoData.oldValues).eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "update_company_brain": {
          const { error } = await supabase.from("mya_company_brain").update(undoData.oldValues).eq("id", 1);
          if (error) undoError = error.message;
          break;
        }
        case "add_estimate_item": {
          const { error } = await supabase.from("mya_estimate_items").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "create_appointment": {
          const { error } = await supabase.from("mya_appointments").delete().eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "reclassify_caller": {
          const { error } = await supabase
            .from("mya_caller_classifications")
            .update({ category: undoData.previousCategory, flag_for_block: undoData.previousFlagForBlock })
            .eq("id", undoData.id);
          if (error) undoError = error.message;
          break;
        }
        case "remove_estimate_item": {
          const it = undoData.item;
          const { error } = await supabase.from("mya_estimate_items").insert({
            id: it.id,
            project_id: it.project_id,
            category: it.category,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit,
            unit_cost: it.unit_cost,
          });
          if (error) undoError = error.message;
          break;
        }
        default:
          undoError = `Don't know how to undo action type "${entry.action_type}".`;
      }

      if (undoError) return { error: undoError };

      await supabase.from("mya_undo_log").update({ undone: true }).eq("id", entry.id);
      return { undone: true, reversed: entry.description };
    },
  },
  {
    name: "remember_fact",
    description: "Store a fact for later recall — a preference, a detail about a project or contact, anything worth remembering. Use when the user says \"remember that...\" or shares something worth keeping.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "The fact to remember, in plain language" } },
      required: ["fact"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const fact = String(input.fact || "").trim();
      if (!fact) return { error: "fact is required" };
      const { data, error } = await supabase.from("mya_remembered_facts").insert({ fact }).select("id,fact").single();
      if (error) return { error: error.message };
      if (data) {
        await logUndo("remember_fact", { id: data.id }, `Remembered: ${data.fact}`);
      }
      return { remembered: data };
    },
  },
  {
    name: "recall_memory",
    description: "Look up facts Mya has been told to remember, optionally filtered by keyword. Use when asked what you remember or know about something.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Optional keyword to search for within remembered facts" } },
      additionalProperties: false,
    },
    execute: async (input) => {
      let query = supabase.from("mya_remembered_facts").select("id,fact,created_at").order("created_at", { ascending: false });
      if (input.query) query = query.ilike("fact", `%${input.query}%`);
      const { data, error } = await query.limit(20);
      if (error) return { error: error.message };
      return { facts: data || [] };
    },
  },
  {
    name: "get_company_brain",
    description: "Get Elevate Construction's standing business info: margin targets, payment terms, warranty language, contract clauses, estimating standards, insurance procedures, equipment notes, and lessons learned.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const { data, error } = await supabase.from("mya_company_brain").select("*").eq("id", 1).maybeSingle();
      if (error) return { error: error.message };
      return { companyBrain: data || {} };
    },
  },
  {
    name: "update_company_brain",
    description: "Update one or more pieces of Elevate Construction's standing business info. Only pass the fields being changed.",
    input_schema: {
      type: "object",
      properties: {
        companyName: { type: "string" },
        licenseInfo: { type: "string" },
        marginTarget: { type: "number", description: "Target profit margin percent, e.g. 35" },
        marginFloor: { type: "number", description: "Minimum acceptable margin percent, e.g. 20" },
        paymentTerms: { type: "string" },
        warrantyTerms: { type: "string" },
        contractClauses: { type: "string" },
        estimatingStandards: { type: "string" },
        insuranceProcedures: { type: "string" },
        equipmentNotes: { type: "string" },
        lessonsLearned: { type: "string" },
      },
      additionalProperties: false,
    },
    execute: async (input) => {
      const fieldMap: Record<string, string> = {
        companyName: "company_name",
        licenseInfo: "license_info",
        marginTarget: "margin_target",
        marginFloor: "margin_floor",
        paymentTerms: "payment_terms",
        warrantyTerms: "warranty_terms",
        contractClauses: "contract_clauses",
        estimatingStandards: "estimating_standards",
        insuranceProcedures: "insurance_procedures",
        equipmentNotes: "equipment_notes",
        lessonsLearned: "lessons_learned",
      };
      const columns = Object.keys(input)
        .filter((k) => fieldMap[k] !== undefined)
        .map((k) => fieldMap[k]);
      if (columns.length === 0) return { error: "No recognized fields to update." };

      const { data: before, error: fetchError } = await supabase
        .from("mya_company_brain")
        .select(columns.join(","))
        .eq("id", 1)
        .maybeSingle();
      if (fetchError) return { error: fetchError.message };

      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const [key, col] of Object.entries(fieldMap)) {
        if (input[key] !== undefined) patch[col] = input[key];
      }

      const { error: updateError } = await supabase.from("mya_company_brain").update(patch).eq("id", 1);
      if (updateError) return { error: updateError.message };

      await logUndo("update_company_brain", { oldValues: before || {} }, `Updated company info: ${columns.join(", ")}`);
      return { updated: true, fields: columns };
    },
  },
  {
    name: "create_project",
    description: "Start tracking a new project/job.",
    input_schema: {
      type: "object",
      properties: {
        projectName: { type: "string", description: "e.g. '3941 Briar Glen Ct'" },
        clientName: { type: "string" },
        clientPhone: { type: "string" },
        clientEmail: { type: "string" },
        projectType: { type: "string", description: "e.g. Residential, Commercial, Insurance Restoration" },
        originalScope: { type: "string" },
      },
      required: ["projectName"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data, error } = await supabase
        .from("mya_projects")
        .insert({
          project_name: String(input.projectName || "").trim(),
          client_name: input.clientName || null,
          client_phone: input.clientPhone || null,
          client_email: input.clientEmail || null,
          project_type: input.projectType || null,
          original_scope: input.originalScope || null,
        })
        .select("id,project_name,client_name")
        .single();
      if (error) return { error: error.message };
      if (data) {
        await logUndo("create_project", { id: data.id }, `Created project ${data.project_name}`);
      }
      return { created: data };
    },
  },
  {
    name: "list_projects",
    description: "List projects, optionally filtered by status (e.g. 'lead', 'estimating', 'contracted', 'in_progress', 'completed', 'lost') or a name/client keyword search.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        query: { type: "string", description: "Keyword to search in project name or client name" },
      },
      additionalProperties: false,
    },
    execute: async (input) => {
      let query = supabase
        .from("mya_projects")
        .select("id,project_name,client_name,project_type,status,next_action,current_estimate")
        .order("updated_at", { ascending: false });
      if (input.status) query = query.eq("status", input.status);
      if (input.query) query = query.or(`project_name.ilike.%${input.query}%,client_name.ilike.%${input.query}%`);
      const { data, error } = await query.limit(25);
      if (error) return { error: error.message };
      return { projects: data || [] };
    },
  },
  {
    name: "get_project",
    description: "Get everything on file for a specific project by name or client name — scope, pricing, decisions, next action, notes. If more than one project matches, this returns the matches instead of guessing.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Project name or client name (or partial)" } },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const { data: matches, error } = await supabase
        .from("mya_projects")
        .select("*")
        .or(`project_name.ilike.%${input.query}%,client_name.ilike.%${input.query}%`);
      if (error) return { error: error.message };
      if (!matches || matches.length === 0) return { found: false, reason: "No project found matching that." };
      if (matches.length > 1) {
        return {
          found: false,
          matches: matches.map((m: any) => ({ id: m.id, project_name: m.project_name, client_name: m.client_name })),
        };
      }
      return { project: matches[0] };
    },
  },
  {
    name: "update_project",
    description: "Update a project's status, scope, measurements, pricing, payment/warranty terms, outstanding decisions, next action, or notes. Finds the project by name/client first — if more than one matches, this returns the matches instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Project name or client name (or partial) to find the project" },
        status: { type: "string" },
        revisedScope: { type: "string" },
        measurements: { type: "string" },
        currentEstimate: { type: "number" },
        proposalVersion: { type: "string" },
        paymentStructure: { type: "string" },
        warrantyChoice: { type: "string" },
        outstandingDecisions: { type: "string" },
        nextAction: { type: "string" },
        notes: { type: "string" },
        contingencyPercent: { type: "number", description: "Risk/contingency percent applied on top of direct cost when calculating this project's estimate" },
        nextActionDue: { type: "string", description: "Date (YYYY-MM-DD) the next action is due — shows up on Today's Schedule when it matches today" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const fieldMap: Record<string, string> = {
        status: "status",
        revisedScope: "revised_scope",
        measurements: "measurements",
        currentEstimate: "current_estimate",
        proposalVersion: "proposal_version",
        paymentStructure: "payment_structure",
        warrantyChoice: "warranty_choice",
        outstandingDecisions: "outstanding_decisions",
        nextAction: "next_action",
        notes: "notes",
        contingencyPercent: "contingency_percent",
        nextActionDue: "next_action_due",
      };
      const columns = Object.keys(input)
        .filter((k) => fieldMap[k] !== undefined)
        .map((k) => fieldMap[k]);
      if (columns.length === 0) return { error: "No recognized fields to update." };

      const { data: matches, error: findError } = await supabase
        .from("mya_projects")
        .select(`id,project_name,client_name,${columns.join(",")}`)
        .or(`project_name.ilike.%${input.query}%,client_name.ilike.%${input.query}%`);
      if (findError) return { error: findError.message };
      if (!matches || matches.length === 0) return { updated: false, reason: "No project found matching that." };
      if (matches.length > 1) {
        return {
          updated: false,
          matches: matches.map((m: any) => ({ id: m.id, project_name: m.project_name, client_name: m.client_name })),
        };
      }

      const before = matches[0] as any;
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      for (const [key, col] of Object.entries(fieldMap)) {
        if (input[key] !== undefined) patch[col] = input[key];
      }
      const oldValues: Record<string, any> = {};
      for (const col of columns) oldValues[col] = before[col];

      const { error: updateError } = await supabase.from("mya_projects").update(patch).eq("id", before.id);
      if (updateError) return { error: updateError.message };

      await logUndo(
        "update_project",
        { id: before.id, oldValues },
        `Updated ${before.project_name}: ${columns.join(", ")}`
      );
      return { updated: true, project: before.project_name, fields: columns };
    },
  },
  {
    name: "create_appointment",
    description: "Schedule a real appointment or site visit — a walkthrough, inspection, or meeting at a specific date/time. Optionally tied to a project.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "e.g. 'Site walkthrough' or 'Permit pickup at city hall'" },
        scheduledAt: { type: "string", description: "ISO date-time (e.g. 2026-09-25T14:00:00) of the appointment" },
        projectQuery: { type: "string", description: "Optional project name/client to tie this appointment to" },
        notes: { type: "string" },
      },
      required: ["title", "scheduledAt"],
      additionalProperties: false,
    },
    execute: async (input) => {
      let projectId: string | null = null;
      let projectName: string | null = null;
      if (input.projectQuery) {
        const found = await findOneProject(input.projectQuery, "id,project_name");
        if (found.error) return { error: found.error };
        if (found.matches) return { created: false, matches: found.matches };
        projectId = found.project.id;
        projectName = found.project.project_name;
      }
      const { data, error } = await supabase
        .from("mya_appointments")
        .insert({ project_id: projectId, title: input.title, scheduled_at: input.scheduledAt, notes: input.notes || null })
        .select("id,title,scheduled_at")
        .single();
      if (error) return { error: error.message };
      if (data) await logUndo("create_appointment", { id: data.id }, `Scheduled "${data.title}"${projectName ? ` for ${projectName}` : ""}`);
      return { created: data };
    },
  },
  {
    name: "list_schedule",
    description: "List what's on today's schedule — appointments/site visits happening today, plus any project whose next action is due today. Same data Today's Schedule shows.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const [todayIso, tomorrowIso, todayDate] = await Promise.all([startOfTodayIso(), startOfTomorrowIso(), todayDateString()]);
      const [appointments, dueProjects] = await Promise.all([
        supabase
          .from("mya_appointments")
          .select("id,title,scheduled_at,notes,project_id")
          .gte("scheduled_at", todayIso)
          .lt("scheduled_at", tomorrowIso)
          .order("scheduled_at"),
        supabase
          .from("mya_projects")
          .select("id,project_name,client_name,next_action")
          .eq("next_action_due", todayDate),
      ]);
      if (appointments.error) return { error: appointments.error.message };
      if (dueProjects.error) return { error: dueProjects.error.message };
      return {
        appointments: appointments.data || [],
        projectActionsToday: (dueProjects.data || []).map((p: any) => ({
          project: p.project_name,
          client: p.client_name,
          action: p.next_action,
        })),
      };
    },
  },
  {
    name: "add_estimate_item",
    description: "Add a real cost line item to a project's estimate (e.g. material, labor, equipment, subcontractor, mobilization, disposal, permit, insurance_bond). Cost = quantity x unitCost — never a guessed lump sum.",
    input_schema: {
      type: "object",
      properties: {
        projectQuery: { type: "string", description: "Project name or client name to find the project" },
        category: { type: "string", enum: ["material", "labor", "equipment", "subcontractor", "mobilization", "disposal", "permit", "insurance_bond"] },
        description: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string", description: "e.g. SF, LF, CY, EA, hours" },
        unitCost: { type: "number" },
      },
      required: ["projectQuery", "category", "description", "quantity", "unitCost"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const found = await findOneProject(input.projectQuery, "id,project_name,client_name,contingency_percent");
      if (found.error) return { error: found.error };
      if (found.matches) return { added: false, matches: found.matches };

      const { data, error } = await supabase
        .from("mya_estimate_items")
        .insert({
          project_id: found.project.id,
          category: input.category,
          description: input.description,
          quantity: input.quantity,
          unit: input.unit || null,
          unit_cost: input.unitCost,
        })
        .select("id,category,description,quantity,unit,unit_cost,line_total")
        .single();
      if (error) return { error: error.message };
      if (data) {
        await logUndo("add_estimate_item", { id: data.id }, `Added estimate item "${data.description}" to ${found.project.project_name}`);
      }
      return { added: data };
    },
  },
  {
    name: "list_estimate_items",
    description: "List every cost line item logged for a project's estimate, with the running direct cost total.",
    input_schema: {
      type: "object",
      properties: { projectQuery: { type: "string" } },
      required: ["projectQuery"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const found = await findOneProject(input.projectQuery, "id,project_name,client_name");
      if (found.error) return { error: found.error };
      if (found.matches) return { matches: found.matches };

      const { data, error } = await supabase
        .from("mya_estimate_items")
        .select("id,category,description,quantity,unit,unit_cost,line_total")
        .eq("project_id", found.project.id)
        .order("category", { ascending: true });
      if (error) return { error: error.message };

      const items = data || [];
      const directCost = items.reduce((sum: number, i: any) => sum + Number(i.line_total || 0), 0);
      return { project: found.project.project_name, items, directCost };
    },
  },
  {
    name: "remove_estimate_item",
    description: "Remove a cost line item from a project's estimate by matching its description. If more than one item matches, this returns the matches instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        projectQuery: { type: "string" },
        description: { type: "string", description: "Text to search for in the item's description" },
      },
      required: ["projectQuery", "description"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const found = await findOneProject(input.projectQuery, "id,project_name,client_name");
      if (found.error) return { error: found.error };
      if (found.matches) return { removed: false, matches: found.matches };

      const { data: items, error: findError } = await supabase
        .from("mya_estimate_items")
        .select("id,category,description,quantity,unit,unit_cost")
        .eq("project_id", found.project.id)
        .ilike("description", `%${input.description}%`);
      if (findError) return { error: findError.message };
      if (!items || items.length === 0) return { removed: false, reason: "No matching estimate item found." };
      if (items.length > 1) {
        return { removed: false, matches: items.map((i: any) => ({ id: i.id, description: i.description })) };
      }

      const { error: deleteError } = await supabase.from("mya_estimate_items").delete().eq("id", items[0].id);
      if (deleteError) return { error: deleteError.message };
      await logUndo(
        "remove_estimate_item",
        { item: { ...items[0], project_id: found.project.id } },
        `Removed estimate item "${items[0].description}" from ${found.project.project_name}`
      );
      return { removed: true, item: items[0] };
    },
  },
  {
    name: "calculate_estimate",
    description: "Calculate a project's real estimate from its logged cost line items: Direct Cost -> True Cost (with contingency) -> Floor Price and Target Price (from the company's margin floor/target). Never fabricates a number — flags anything missing (no line items, no contingency percent set, no company margin set) instead of guessing.",
    input_schema: {
      type: "object",
      properties: { projectQuery: { type: "string" } },
      required: ["projectQuery"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const found = await findOneProject(input.projectQuery, "id,project_name,client_name,contingency_percent");
      if (found.error) return { error: found.error };
      if (found.matches) return { matches: found.matches };

      const { data: items, error: itemsError } = await supabase
        .from("mya_estimate_items")
        .select("category,line_total")
        .eq("project_id", found.project.id);
      if (itemsError) return { error: itemsError.message };
      if (!items || items.length === 0) {
        return { project: found.project.project_name, reason: "No estimate line items logged yet — add costs with add_estimate_item first." };
      }

      const byCategory: Record<string, number> = {};
      let directCost = 0;
      for (const i of items as any[]) {
        const total = Number(i.line_total || 0);
        directCost += total;
        byCategory[i.category] = (byCategory[i.category] || 0) + total;
      }

      const contingencyPercentSet = found.project.contingency_percent !== null && found.project.contingency_percent !== undefined;
      const contingencyPercent = contingencyPercentSet ? Number(found.project.contingency_percent) : 0;
      const contingencyAmount = directCost * (contingencyPercent / 100);
      const trueCost = directCost + contingencyAmount;

      const { data: brain } = await supabase.from("mya_company_brain").select("margin_target,margin_floor").eq("id", 1).maybeSingle();
      const marginTarget = brain?.margin_target;
      const marginFloor = brain?.margin_floor;

      const result: Record<string, any> = {
        project: found.project.project_name,
        directCostByCategory: byCategory,
        directCost: round2(directCost),
        contingencyPercent,
        contingencyPercentWasSet: contingencyPercentSet,
        contingencyAmount: round2(contingencyAmount),
        trueCost: round2(trueCost),
      };
      if (marginFloor === null || marginFloor === undefined) {
        result.note = "Company margin floor isn't set — can't compute floor/target price. Set it with update_company_brain.";
        return result;
      }
      result.marginFloor = marginFloor;
      result.floorPrice = round2(trueCost / (1 - Number(marginFloor) / 100));
      if (marginTarget !== null && marginTarget !== undefined) {
        result.marginTarget = marginTarget;
        result.targetPrice = round2(trueCost / (1 - Number(marginTarget) / 100));
        result.recommendedBid = result.targetPrice;
      } else {
        result.note = "Company margin target isn't set — floor price only. Set a target with update_company_brain for a recommended bid.";
      }
      return result;
    },
  },
  {
    name: "evaluate_bid_price",
    description: "Show what a specific bid price actually means for a project: direct cost, true cost, gross profit, gross margin percent, markup percent, and whether it falls below the company's minimum margin. Use for \"what happens if we bid this at $X\" questions.",
    input_schema: {
      type: "object",
      properties: {
        projectQuery: { type: "string" },
        bidPrice: { type: "number" },
      },
      required: ["projectQuery", "bidPrice"],
      additionalProperties: false,
    },
    execute: async (input) => {
      const found = await findOneProject(input.projectQuery, "id,project_name,client_name,contingency_percent");
      if (found.error) return { error: found.error };
      if (found.matches) return { matches: found.matches };

      const { data: items, error: itemsError } = await supabase
        .from("mya_estimate_items")
        .select("line_total")
        .eq("project_id", found.project.id);
      if (itemsError) return { error: itemsError.message };
      if (!items || items.length === 0) {
        return { project: found.project.project_name, reason: "No estimate line items logged yet — add costs with add_estimate_item first." };
      }

      const directCost = (items as any[]).reduce((sum, i) => sum + Number(i.line_total || 0), 0);
      const contingencyPercentSet = found.project.contingency_percent !== null && found.project.contingency_percent !== undefined;
      const contingencyPercent = contingencyPercentSet ? Number(found.project.contingency_percent) : 0;
      const trueCost = directCost * (1 + contingencyPercent / 100);

      const bidPrice = Number(input.bidPrice);
      const grossProfit = bidPrice - trueCost;
      const grossMarginPercent = bidPrice !== 0 ? (grossProfit / bidPrice) * 100 : null;
      const markupPercent = trueCost !== 0 ? (grossProfit / trueCost) * 100 : null;

      const { data: brain } = await supabase.from("mya_company_brain").select("margin_floor").eq("id", 1).maybeSingle();
      const marginFloor = brain?.margin_floor;

      const result: Record<string, any> = {
        project: found.project.project_name,
        directCost: round2(directCost),
        contingencyPercentWasSet: contingencyPercentSet,
        trueCost: round2(trueCost),
        bidPrice: round2(bidPrice),
        grossProfit: round2(grossProfit),
        grossMarginPercent: grossMarginPercent !== null ? round2(grossMarginPercent) : null,
        markupPercent: markupPercent !== null ? round2(markupPercent) : null,
      };
      if (marginFloor === null || marginFloor === undefined) {
        result.note = "Company margin floor isn't set, so I can't say whether this is below your minimum acceptable margin. Set it with update_company_brain.";
      } else {
        result.marginFloor = marginFloor;
        result.belowMarginFloor = grossMarginPercent !== null && grossMarginPercent < Number(marginFloor);
      }
      return result;
    },
  },
];

const TOOLS = SKILLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

function findSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name);
}

async function executeTool(name: string, input: any): Promise<{ result: any; toolUsed: string }> {
  const skill = findSkill(name);
  if (!skill) return { toolUsed: name, result: { error: `Unknown tool: ${name}` } };
  try {
    const result = await skill.execute(input || {});
    return { toolUsed: name, result };
  } catch (err: any) {
    return { toolUsed: name, result: { error: err?.message || "Skill failed" } };
  }
}

// Turns reply text into speech using the same ElevenLabs voice as the phone
// system. Returns null (never throws) if not configured or the call fails —
// voice is a nice-to-have, it should never break the text reply.
async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID || !text) return null;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          // Matches the "V3 Conversational" model the phone agent's voice
          // uses — the older turbo model here sounded noticeably flatter
          // and more robotic than the same voice on a real call.
          model_id: "eleven_v3",
        }),
      }
    );
    if (!res.ok) {
      console.error("ElevenLabs TTS failed:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
  } catch (err) {
    console.error("ElevenLabs TTS error:", err);
    return null;
  }
}

async function callAnthropic(messages: any[]): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: SYSTEM_PROMPT,
      messages,
      tools: TOOLS,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Fast path for the dashboard's own UI controls (the Company Contacts
  // category dropdown) that already know exactly which tool to call —
  // skips Claude entirely so a plain UI action doesn't cost a wasted API
  // call or need ANTHROPIC_API_KEY at all. Chat/voice always goes through
  // Claude below. Allowlisted to the one tool meant for direct UI use.
  const DIRECT_TOOL_ALLOWLIST = new Set(["reclassify_caller", "undo_last_action"]);
  const directTool = (req.body || {}).directTool;
  if (typeof directTool === "string") {
    if (!DIRECT_TOOL_ALLOWLIST.has(directTool)) {
      return res.status(400).json({ error: `"${directTool}" isn't available as a direct action.` });
    }
    const { result } = await executeTool(directTool, (req.body || {}).input || {});
    await logActionEvent({ toolName: directTool, input: (req.body || {}).input || {}, result, surface: "dashboard_direct_ui" });
    return res.status(200).json({ result });
  }

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set." });
  }

  const userMessage = typeof (req.body || {}).message === "string" ? req.body.message.trim() : "";
  if (!userMessage) {
    return res.status(400).json({ error: "message is required" });
  }
  const wantsVoice = (req.body || {}).voice === true;

  // Serverless functions have no memory between requests, so without this
  // the dashboard's chat forgets everything the instant one request ends —
  // fine for a one-off command, but it means a direct follow-up answer to
  // something Mya just asked lands with zero context. The dashboard sends
  // back its own recent turns; validated and capped defensively here since
  // it's client-supplied.
  const rawHistory = Array.isArray((req.body || {}).history) ? req.body.history : [];
  const history = rawHistory
    .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: m.content }));

  const messages: any[] = [...history, { role: "user", content: userMessage }];
  const toolsUsed: string[] = [];

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await callAnthropic(messages);
      const toolUseBlocks = (response.content || []).filter((b: any) => b.type === "tool_use");

      if (toolUseBlocks.length === 0) {
        const reply = (response.content || [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n")
          .trim() || "Done.";
        const audioBase64 = wantsVoice ? await synthesizeSpeech(reply) : null;
        return res.status(200).json({ reply, toolsUsed, audioBase64 });
      }

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tu: any) => {
          const { result, toolUsed } = await executeTool(tu.name, tu.input || {});
          toolsUsed.push(toolUsed);
          await logActionEvent({ toolName: toolUsed, input: tu.input || {}, result, surface: "dashboard_or_desktop_chat" });
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
        })
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    const tooManySteps = "That request took too many steps — try breaking it into something simpler.";
    return res.status(200).json({
      reply: tooManySteps,
      toolsUsed,
      audioBase64: wantsVoice ? await synthesizeSpeech(tooManySteps) : null,
    });
  } catch (err: any) {
    console.error("command-center-ask-mya error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
