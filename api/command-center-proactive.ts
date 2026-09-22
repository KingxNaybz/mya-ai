import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as the other command-center-*.ts endpoints: no
 * password/key check of its own — relies entirely on Vercel's own
 * "Deployment Protection" for the environment this is deployed to.
 * Read-only.
 *
 * PROACTIVE CHECK-INS: this is Mya noticing something without being asked
 * — a pending approval sitting too long, a follow-up that's overdue — and
 * surfacing it when the dashboard loads. There's no background job here
 * (Vercel Cron would need editing vercel.json, off-limits): this is a
 * plain deterministic check run each time the dashboard is opened, not an
 * LLM call, so it costs nothing and never hallucinates.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const STALE_APPROVAL_HOURS = 24;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    console.error("command-center-proactive error:", err);
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
