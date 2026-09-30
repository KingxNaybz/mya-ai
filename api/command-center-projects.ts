import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { isCommandCenterAuthenticated } from "../lib/session";

/**
 * Requires a valid dashboard session cookie or COMMAND_CENTER_API_KEY (see
 * isCommandCenterAuthenticated in lib/session.ts) -- checked before any
 * Supabase query runs, for both branches below.
 * Read-only — projects are created/updated via Ask Mya's create_project/
 * update_project skills (command-center-ask-mya.ts).
 *
 * Handles two things in one file, kept together specifically to stay under
 * Vercel Hobby's serverless function count limit (12 per deployment):
 *   - default (no query): the "Projects Needing Attention" panel's list
 *   - ?type=alerts: the proactive check-in alerts (a pending approval
 *     sitting too long, an overdue follow-up) — a plain deterministic
 *     check, not an LLM call, run each time the dashboard loads. No
 *     background job here (Vercel Cron would need editing vercel.json,
 *     off-limits).
 *   - ?type=detail&id=<uuid>: one project with its estimate line items and
 *     upcoming appointments (mirrors the get_project skill's select("*")
 *     plus list_estimate_items' columns; the skills themselves are
 *     untouched).
 *   - ?type=search&q=<text>: name/client keyword search across ALL
 *     statuses (same filter semantics as the list_projects skill), capped.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STALE_APPROVAL_HOURS = 24;

async function handleProactiveAlerts(res: VercelResponse) {
  const staleThreshold = new Date(Date.now() - STALE_APPROVAL_HOURS * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    const [staleApprovals, overdueFollowups] = await Promise.all([
      supabase
        .from("mya_approvals")
        .select("id,title,requested_at")
        .eq("status", "pending")
        .lt("requested_at", staleThreshold)
        .order("requested_at", { ascending: true }),
      supabase
        .from("mya_followups")
        .select("id,customer_name,due_at")
        .eq("status", "open")
        .not("due_at", "is", null)
        .lt("due_at", nowIso)
        .order("due_at", { ascending: true }),
    ]);

    const alerts: { message: string; severity: "warning" | "info" }[] = [];

    const approvals = staleApprovals.data || [];
    if (approvals.length === 1) {
      alerts.push({
        message: `"${approvals[0].title}" has been waiting for your approval for over ${STALE_APPROVAL_HOURS} hours.`,
        severity: "warning",
      });
    } else if (approvals.length > 1) {
      alerts.push({
        message: `${approvals.length} approvals have been pending for over ${STALE_APPROVAL_HOURS} hours — the oldest is "${approvals[0].title}".`,
        severity: "warning",
      });
    }

    const followups = overdueFollowups.data || [];
    if (followups.length === 1) {
      alerts.push({
        message: `The follow-up for ${followups[0].customer_name} is overdue.`,
        severity: "warning",
      });
    } else if (followups.length > 1) {
      alerts.push({
        message: `${followups.length} follow-ups are overdue — the oldest is for ${followups[0].customer_name}.`,
        severity: "warning",
      });
    }

    return res.status(200).json({ alerts });
  } catch (err: any) {
    console.error("command-center-projects (alerts) error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}

async function handleProjectsList(res: VercelResponse) {
  const { data, error } = await supabase
    .from("mya_projects")
    .select("id,project_name,client_name,status,next_action,outstanding_decisions,updated_at")
    .not("status", "in", "(completed,lost)")
    .order("updated_at", { ascending: false })
    .limit(6);

  if (error) {
    console.error("command-center-projects GET error:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ projects: data || [] });
}

// PostgREST .or() takes a filter *string*, so characters that are syntax
// there (commas, parens, wildcards, quotes, backslashes) are stripped from
// user text before it goes in -- a search box must never be able to add
// its own filter clauses.
function cleanSearchText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[,()*%\\"'`:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

const SEARCH_LIMIT = 25;

async function handleProjectSearch(req: VercelRequest, res: VercelResponse) {
  const q = cleanSearchText(req.query.q);
  if (!q) return res.status(400).json({ error: "q is required" });
  const { data, error } = await supabase
    .from("mya_projects")
    .select("id,project_name,client_name,project_type,status,next_action,outstanding_decisions,updated_at")
    .or(`project_name.ilike.%${q}%,client_name.ilike.%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(SEARCH_LIMIT);
  if (error) {
    console.error("command-center-projects GET search error:", error);
    return res.status(500).json({ error: "Couldn't search projects." });
  }
  return res.status(200).json({ projects: data || [], limit: SEARCH_LIMIT });
}

async function handleProjectDetail(req: VercelRequest, res: VercelResponse) {
  const id = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (!id || id.length > 64 || !/^[A-Za-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "id is required" });
  }
  try {
    const { data: project, error } = await supabase.from("mya_projects").select("*").eq("id", id).maybeSingle();
    if (error) {
      console.error("command-center-projects GET detail error:", error);
      return res.status(500).json({ error: "Couldn't load that project." });
    }
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Each part is independent: a failed side query is reported as null
    // ("we don't know"), never as an empty list that looks real.
    const [items, upcoming] = await Promise.all([
      supabase
        .from("mya_estimate_items")
        .select("id,category,description,quantity,unit,unit_cost,line_total")
        .eq("project_id", id)
        .order("category", { ascending: true }),
      supabase
        .from("mya_appointments")
        .select("title,scheduled_at,notes")
        .eq("project_id", id)
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(5),
    ]);
    const estimateItems = items.error ? null : items.data || [];
    return res.status(200).json({
      project,
      estimateItems,
      directCost: estimateItems ? estimateItems.reduce((sum: number, i: any) => sum + Number(i.line_total || 0), 0) : null,
      upcoming: upcoming.error ? null : upcoming.data || [],
    });
  } catch (err: any) {
    console.error("command-center-projects GET detail error:", err);
    return res.status(500).json({ error: "Couldn't load that project." });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isCommandCenterAuthenticated(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.query.type === "alerts") {
    return handleProactiveAlerts(res);
  }
  if (req.query.type === "detail") return handleProjectDetail(req, res);
  if (req.query.type === "search") return handleProjectSearch(req, res);
  return handleProjectsList(res);
}
