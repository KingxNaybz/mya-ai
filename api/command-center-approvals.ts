import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

/**
 * Same protection model as command-center-data.ts: no password/key check of
 * its own — relies entirely on Vercel's own "Deployment Protection" for the
 * environment this is deployed to. Unlike that endpoint, this one WRITES
 * (resolves an approval), so it's more consequential to leave unprotected.
 * Do not merge to main without Deployment Protection covering Production
 * too, or a proper page-level login in front of the Command Center.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER || "+16782440023";
const OWNER_PHONE = process.env.OWNER_PHONE_NUMBER || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** Same Twilio SMS pattern already used by the phone-system endpoints. */
async function sendSms(to: string, body: string) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !to) return;
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: body }).toString(),
    }
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("mya_approvals")
      .select("id,title,detail,status,requested_at,action_type")
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error("command-center-approvals GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ approvals: data || [] });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const id = body.id;
    const action = body.action;

    if (!id || (action !== "approve" && action !== "decline")) {
      return res.status(400).json({ error: "id and action ('approve'|'decline') are required" });
    }

    // The .eq("status", "pending") guard means this only succeeds once —
    // a second click (e.g. a double-submit) can't flip an already-resolved
    // row again.
    const { data, error } = await supabase
      .from("mya_approvals")
      .update({
        status: action === "approve" ? "approved" : "declined",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("id,status,title,action_type")
      .maybeSingle();

    if (error) {
      console.error("command-center-approvals POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(409).json({ error: "Already resolved or not found" });
    }

    let manualFollowUpNeeded = false;

    if (action === "approve" && data.action_type === "notify_owner") {
      await sendSms(OWNER_PHONE, `✅ Approved: ${data.title}`);
    }

    if (action === "approve" && data.action_type === "send_to_customer") {
      // Not automated yet — there's no defined content/channel for what
      // should go out to the customer. Recorded as approved; the owner
      // still needs to follow up manually until this is specified.
      manualFollowUpNeeded = true;
    }

    return res.status(200).json({ ok: true, id: data.id, status: data.status, manualFollowUpNeeded });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
