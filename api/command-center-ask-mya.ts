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
- If the user tells you to remember something, or shares a fact/preference/detail worth keeping for later ("remember that...", "the Rivers project needs..."), call remember_fact. If asked what you remember or know about something, call recall_memory rather than guessing.
- Projects are the company's real jobs (e.g. "3941 Briar Glen Ct" / "Courtney Vonwalsung"). When asked about a specific project, call get_project rather than guessing at details — it returns everything on file for that job. Use create_project when a new job should be tracked, update_project to record scope/status/pricing/decision changes, and list_projects to see what's open or in a given status.
- The Company Brain holds standing business info (margin targets, payment terms, warranty language, estimating standards, insurance procedures, lessons learned) — call get_company_brain when asked about company policy/standards, and update_company_brain when told to change one.
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
