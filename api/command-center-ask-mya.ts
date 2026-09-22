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

const SYSTEM_PROMPT = `You are Mya, an AI operations assistant embedded in a dashboard for Elevate Construction, a construction company. The owner (Michael) talks to you here to check on the business and to make real changes using the tools you're given.

Rules:
- Only call a tool when the request actually needs an action or a lookup. For small talk or things no tool covers, just reply normally.
- If a lookup tool (e.g. removing or approving something by name) returns more than one match, do not guess — list the matches in your reply and ask which one they mean.
- If a tool returns zero matches, say so plainly rather than assuming.
- After taking an action, confirm in one short sentence what you did.
- If asked what you can do, what your capabilities are, or what you can't do yet, call list_capabilities rather than describing yourself from memory — that list is the real, current one.
- If the user says "undo", "undo that", or asks to reverse the last thing you did, call undo_last_action. Don't guess which action they mean — that skill always reverses the single most recent reversible action.
- Keep replies brief and conversational — this is read out loud / read at a glance on a dashboard, not a report.`;

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

type Skill = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute: (input: any) => Promise<any>;
};

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
      note: "Anything not in this list — e.g. controlling this computer, taking screenshots, phone-call actions — is not wired up yet.",
    }),
  },
  {
    name: "get_dashboard_summary",
    description: "Get a quick snapshot of today's business: calls today, new leads, open follow-ups, and pending approvals.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    execute: async () => {
      const todayIso = await startOfTodayIso();
      const [calls, leads, followups, approvals] = await Promise.all([
        supabase.from("calls").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
        supabase.from("mya_contacts").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("mya_followups").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("mya_approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      return {
        callsToday: calls.count ?? 0,
        newLeads: leads.count ?? 0,
        openFollowUps: followups.count ?? 0,
        pendingApprovals: approvals.count ?? 0,
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
        default:
          undoError = `Don't know how to undo action type "${entry.action_type}".`;
      }

      if (undoError) return { error: undoError };

      await supabase.from("mya_undo_log").update({ undone: true }).eq("id", entry.id);
      return { undone: true, reversed: entry.description };
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

  if (!ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "not_configured", message: "ANTHROPIC_API_KEY is not set." });
  }

  const userMessage = typeof (req.body || {}).message === "string" ? req.body.message.trim() : "";
  if (!userMessage) {
    return res.status(400).json({ error: "message is required" });
  }

  const messages: any[] = [{ role: "user", content: userMessage }];
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
          .trim();
        return res.status(200).json({ reply: reply || "Done.", toolsUsed });
      }

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tu: any) => {
          const { result, toolUsed } = await executeTool(tu.name, tu.input || {});
          toolsUsed.push(toolUsed);
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result) };
        })
      );

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });
    }

    return res.status(200).json({
      reply: "That request took too many steps — try breaking it into something simpler.",
      toolsUsed,
    });
  } catch (err: any) {
    console.error("command-center-ask-mya error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
