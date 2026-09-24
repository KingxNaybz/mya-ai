import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { createSessionToken, sessionCookieHeader, clearSessionCookieHeader, safeStringEqual } from "../lib/session";

/**
 * The settings GET/POST behavior below is intentionally unchanged and still
 * has no auth check of its own (out of scope for this remediation pass —
 * see the Production Endpoint Security Review). This file's new
 * responsibility is narrower: it issues and clears the dashboard session
 * cookie that /api/command-center-ask-mya requires, via the { login: true }
 * and { logout: true } branches below, and throttles repeated failed
 * logins against mya_login_attempts. Those branches are the only new auth
 * surface added here.
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "";

const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

// Trimmed deliberately: a value pasted into Vercel's env var editor (or
// typed into the browser's password field) that picks up an invisible
// trailing newline or space is a common, real operator error -- confirmed
// as the leading suspect after a Preview login failed with a freshly
// generated, correctly-scoped password. Trimming both sides of the
// comparison below removes that footgun without reducing the actual
// security floor: an attacker still needs the exact (trimmed) secret,
// and a deliberately whitespace-padded password is not a realistic use
// case for a single-owner dashboard credential.
const DASHBOARD_PASSWORD = (process.env.DASHBOARD_PASSWORD || "").trim();
const SESSION_SIGNING_SECRET = process.env.SESSION_SIGNING_SECRET || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const SETTINGS_COLUMNS = "owner_name,footer_tagline,notify_enabled,notify_phone";

// Conservative defaults for a single-owner administrative dashboard: 5
// failed attempts within a 15-minute window triggers a 15-minute lockout.
// Configurable via env vars without touching code, per instruction.
const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || "", 10) || 5;
const LOGIN_WINDOW_MS = (parseInt(process.env.LOGIN_WINDOW_MINUTES || "", 10) || 15) * 60 * 1000;
const LOGIN_LOCKOUT_MS = (parseInt(process.env.LOGIN_LOCKOUT_MINUTES || "", 10) || 15) * 60 * 1000;

// Keyed by client IP (falling back to a fixed bucket if none is presented,
// which Vercel practically always sets). Never keyed by, or storing, the
// submitted password.
function getLoginRateLimitKey(req: VercelRequest): string {
  const xff = (req.headers || {})["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : xff;
  const ip = typeof first === "string" ? first.split(",")[0].trim() : "";
  return ip || "unknown";
}

// "unavailable" means the rate-limit store itself couldn't be read -- the
// caller must treat that as a hard stop (fail closed), never as "allow",
// per instruction that a rate-limiter outage must not bypass throttling.
async function checkLoginLock(key: string): Promise<"allow" | "locked" | "unavailable"> {
  const { data, error } = await supabase
    .from("mya_login_attempts")
    .select("locked_until")
    .eq("id", key)
    .maybeSingle();
  if (error) {
    console.error("command-center-settings login rate-limit read failed:", error.message);
    return "unavailable";
  }
  if (data && data.locked_until && new Date(data.locked_until).getTime() > Date.now()) {
    return "locked";
  }
  return "allow";
}

// Records a failed attempt (incrementing within the rolling window, locking
// once LOGIN_MAX_ATTEMPTS is crossed) or clears the record on success.
// Returns false only when a WRITE needed to enforce throttling itself
// failed -- an unrecorded failure can't be reliably throttled, so the
// caller rejects that login attempt rather than silently letting it
// through unrecorded. A failed RESET after a successful login never blocks
// that login: existing valid sessions and successful auth must not depend
// on this store being healthy, only new/repeated failed attempts do.
async function recordLoginResult(key: string, success: boolean): Promise<boolean> {
  if (success) {
    const { error } = await supabase.from("mya_login_attempts").delete().eq("id", key);
    if (error) console.error("command-center-settings login rate-limit reset failed:", error.message);
    return true;
  }

  const now = Date.now();
  const { data, error: readError } = await supabase
    .from("mya_login_attempts")
    .select("failed_count, window_started_at")
    .eq("id", key)
    .maybeSingle();
  if (readError) {
    console.error("command-center-settings login rate-limit read failed:", readError.message);
    return false;
  }

  let failedCount = 1;
  let windowStartedAt = new Date(now).toISOString();
  if (data) {
    const windowAgeMs = now - new Date(data.window_started_at).getTime();
    if (windowAgeMs < LOGIN_WINDOW_MS) {
      failedCount = data.failed_count + 1;
      windowStartedAt = data.window_started_at;
    }
  }
  const lockedUntil = failedCount >= LOGIN_MAX_ATTEMPTS ? new Date(now + LOGIN_LOCKOUT_MS).toISOString() : null;

  const { error: writeError } = await supabase.from("mya_login_attempts").upsert({
    id: key,
    failed_count: failedCount,
    window_started_at: windowStartedAt,
    locked_until: lockedUntil,
    updated_at: new Date(now).toISOString(),
  });
  if (writeError) {
    console.error("command-center-settings login rate-limit write failed:", writeError.message);
    return false;
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    // Temporary diagnostic for the current Preview login investigation --
    // reveals ONLY whether DASHBOARD_PASSWORD is set and how many
    // characters long it is AFTER trimming, never the value, a hash, or
    // any prefix/suffix. A length mismatch against what you actually
    // generated is the single fastest way to confirm a whitespace/paste
    // artifact without spending another attempt against the rate limiter.
    // Remove this route once the investigation is resolved -- it isn't
    // needed for the feature to work, only to debug this one incident.
    if ((req.query || {}).diagnose === "dashboard-password") {
      return res.status(200).json({
        dashboardPasswordConfigured: Boolean(DASHBOARD_PASSWORD),
        dashboardPasswordLength: DASHBOARD_PASSWORD.length,
        // SESSION_SIGNING_SECRET is a separate required var (see edb3024) --
        // a login can pass the password check and still fail with "Session
        // signing is not configured" if this one is missing on this
        // deployment specifically. Same rule as above: presence only, never
        // the value or its length (no legitimate reason to leak length for
        // a secret that's never human-typed at login).
        sessionSigningSecretConfigured: Boolean(SESSION_SIGNING_SECRET),
      });
    }

    const { data, error } = await supabase
      .from("mya_settings")
      .select(SETTINGS_COLUMNS)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.error("command-center-settings GET error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ settings: data || null });
  }

  if (req.method === "POST") {
    const body = req.body || {};

    if (body.logout === true) {
      // No credential check needed to log out -- clearing a cookie that may
      // already be absent or invalid is harmless, and never touches
      // COMMAND_CENTER_API_KEY or any future MCP credential.
      res.setHeader("Set-Cookie", clearSessionCookieHeader());
      return res.status(200).json({ ok: true });
    }

    if (body.diagnoseHash === true) {
      // Temporary, for the current Preview login investigation only --
      // remove once resolved. Deliberately does NOT return either side's
      // hash: publishing a bare hash of the password from an
      // unauthenticated endpoint would let it be brute-forced completely
      // offline, with no rate limit, no lockout, and no audit trail --
      // bypassing mya_login_attempts entirely. Instead, the caller submits
      // a SHA-256 of their own candidate (computed locally, e.g. from a
      // clipboard value, never sent as plaintext) and gets back only
      // whether it matches -- the same amount of information a real login
      // attempt would reveal, no more.
      const submitted = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
      const actual = createHash("sha256").update(DASHBOARD_PASSWORD).digest("hex");
      const matches = submitted.length === 64 && safeStringEqual(submitted, actual);
      return res.status(200).json({
        dashboardPasswordConfigured: Boolean(DASHBOARD_PASSWORD),
        matches,
      });
    }

    if (body.login === true) {
      const password = typeof body.password === "string" ? body.password.trim() : "";
      const rateLimitKey = getLoginRateLimitKey(req);

      const lockState = await checkLoginLock(rateLimitKey);
      if (lockState === "unavailable") {
        return res.status(503).json({ error: "Login temporarily unavailable. Try again shortly." });
      }
      if (lockState === "locked") {
        return res.status(429).json({ error: "Too many attempts. Try again later." });
      }

      if (!DASHBOARD_PASSWORD || !password || !safeStringEqual(password, DASHBOARD_PASSWORD)) {
        const recorded = await recordLoginResult(rateLimitKey, false);
        if (!recorded) {
          return res.status(503).json({ error: "Login temporarily unavailable. Try again shortly." });
        }
        return res.status(401).json({ error: "Invalid password" });
      }

      if (!SESSION_SIGNING_SECRET) {
        // Fail closed: never issue a session that can't be independently
        // signed and verified.
        return res.status(503).json({ error: "Session signing is not configured." });
      }

      await recordLoginResult(rateLimitKey, true); // best-effort reset; never blocks a successful login
      const token = createSessionToken(SESSION_SIGNING_SECRET);
      res.setHeader("Set-Cookie", sessionCookieHeader(token));
      return res.status(200).json({ ok: true });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.ownerName === "string") update.owner_name = body.ownerName.trim().slice(0, 60);
    if (typeof body.footerTagline === "string") update.footer_tagline = body.footerTagline.trim().slice(0, 140);
    if (typeof body.notifyEnabled === "boolean") update.notify_enabled = body.notifyEnabled;
    if (typeof body.notifyPhone === "string") update.notify_phone = body.notifyPhone.trim().slice(0, 20) || null;

    const { data, error } = await supabase
      .from("mya_settings")
      .update(update)
      .eq("id", 1)
      .select(SETTINGS_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error("command-center-settings POST error:", error);
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true, settings: data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
