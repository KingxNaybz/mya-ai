/**
 * Narrow, read-only adapters from the Command Center to systems that live
 * OUTSIDE this repo (Hermes runtime, Hindsight memory). The Command Center
 * never re-implements them; it only asks them small, documented, read-only
 * questions, server-side, so no credential ever reaches the browser.
 *
 * Rules (see agent-os/specs/2026-09-30-0114-cc-phase2-executive-mya/):
 *   - Only VERIFIED contracts get a network call. Anything we can't verify
 *     reports "not_observable" rather than guessing an endpoint.
 *   - Env is read per call (never module-level consts).
 *   - One fetch per operation, hard timeout, normalized output only --
 *     never an upstream body, header, or secret echoed back.
 *   - Hindsight is READ-ONLY from here: this file has no retain / write /
 *     delete function, on purpose. Never import this from the reception
 *     pipeline (api/mya-*.ts, api/outbound-call.ts).
 *
 * Deliberately free of Vercel/Supabase imports (and of relative imports) so
 * tests can load it directly with `node --test`.
 */

// up / down           a real read-only check just succeeded / failed
// configured          credentials are set, but nothing was checked live
// not_configured      credentials missing -- the Command Center can't reach it
// not_observable      no verified signal exists to check it from here
export type SystemStatus = "up" | "down" | "configured" | "not_configured" | "not_observable";

export type SystemReport = {
  id: string;
  name: string;
  status: SystemStatus;
  detail: string;
  checkedAt: string;
  latencyMs: number | null;
  lastActivityAt?: string | null;
};

type Env = Record<string, string | undefined>;
type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export type AdapterOptions = {
  env?: Env;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

export const DEFAULT_TIMEOUT_MS = 2500;

function resolve(opts: AdapterOptions | undefined) {
  const o = opts || {};
  return {
    env: o.env || (process.env as Env),
    fetch: o.fetch || (globalThis.fetch as unknown as FetchLike),
    now: o.now || Date.now,
    timeoutMs: o.timeoutMs || DEFAULT_TIMEOUT_MS,
  };
}

function report(id: string, name: string, status: SystemStatus, detail: string, now: number, latencyMs: number | null = null): SystemReport {
  return { id, name, status, detail, checkedAt: new Date(now).toISOString(), latencyMs };
}

/** One fetch with a hard timeout. Throws "timeout" or "network" -- never the
 * upstream error text, which could carry URLs or headers. */
async function timedFetch(r: ReturnType<typeof resolve>, url: string, init: any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), r.timeoutMs);
  const started = r.now();
  try {
    const res = await r.fetch(url, { ...init, signal: controller.signal });
    return { res, latencyMs: Math.max(0, r.now() - started) };
  } catch (err: any) {
    throw new Error(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Hermes runtime ----------------
 * The only VERIFIED Hermes interface in this codebase is
 * POST {HERMES_BRIDGE_URL}/chat/completions (command-center-ask-mya.ts) --
 * a paid model call, not a health signal. No documented read-only status
 * endpoint exists for the production multiplex (Open WebUI → Cloudflare →
 * Hermes), so we don't probe one: a configured key reports "not_observable",
 * never "up". Telegram and the local router are only visible inside Hermes. */
export function hermesStatus(opts?: AdapterOptions): SystemReport[] {
  const r = resolve(opts);
  const now = r.now();
  const configured = Boolean(r.env.HERMES_BRIDGE_KEY);
  const hermes = configured
    ? report("hermes", "Mya runtime (Hermes VPS)", "not_observable",
        "Configured here, but Hermes exposes no documented read-only health check this dashboard can use.", now)
    : report("hermes", "Mya runtime (Hermes VPS)", "not_configured", "HERMES_BRIDGE_KEY isn't set for the Command Center.", now);
  const insideHermes = "Only visible inside the Hermes runtime — no documented status signal reaches the Command Center.";
  return [
    hermes,
    report("telegram", "Telegram", "not_observable", insideHermes, now),
    report("router", "Local Qwen router", "not_observable", insideHermes, now),
  ];
}

/* ---------------- Hindsight memory (read-only) ----------------
 * Contract verified against the Hindsight Cloud API reference (v0.10.1) and
 * its documented cURL examples (docs.hindsight.vectorize.io):
 *   auth    Authorization: Bearer <key>          (keys start with "hsk_")
 *   bank    GET  {base}/v1/default/banks/{bank_id}            -- read-only
 *   recall  POST {base}/v1/default/banks/{bank_id}/memories/recall {query}
 *           → { results: [{ id, text, type, entities }] }
 * bank_id is a user-chosen identifier for one memory space (the bank Mya's
 * Hermes runtime retains into). Recall consumes Hindsight recall credits, so
 * it runs only on an explicit search/question -- never from a health probe.
 * Retain / reflect / delete are intentionally NOT implemented. */
const HINDSIGHT_BANK_RE = /^[A-Za-z0-9._:-]{1,128}$/;
export const HINDSIGHT_MAX_QUERY = 500;
export const HINDSIGHT_MAX_LIMIT = 20;

function hindsightConfig(env: Env) {
  const base = (env.HINDSIGHT_API_URL || "").trim().replace(/\/+$/, "");
  const key = (env.HINDSIGHT_API_KEY || "").trim();
  const bank = (env.HINDSIGHT_BANK_ID || "").trim();
  if (!base || !key || !bank) return null;
  // Never send the key over plain HTTP or to a malformed URL.
  if (!/^https:\/\/[^/\s]+/.test(base)) return null;
  if (!HINDSIGHT_BANK_RE.test(bank)) return null;
  return { base, key, bankPath: `${base}/v1/default/banks/${encodeURIComponent(bank)}` };
}

const HINDSIGHT_NAME = "Hindsight memory";
const HINDSIGHT_NOT_CONFIGURED =
  "Set HINDSIGHT_API_URL (https), HINDSIGHT_API_KEY and HINDSIGHT_BANK_ID for the Command Center to read it.";

export async function hindsightHealth(opts?: AdapterOptions): Promise<SystemReport> {
  const r = resolve(opts);
  const cfg = hindsightConfig(r.env);
  if (!cfg) return report("hindsight", HINDSIGHT_NAME, "not_configured", HINDSIGHT_NOT_CONFIGURED, r.now());
  try {
    const { res, latencyMs } = await timedFetch(r, cfg.bankPath, {
      method: "GET",
      headers: { Authorization: `Bearer ${cfg.key}`, Accept: "application/json" },
    });
    if (res.ok) return report("hindsight", HINDSIGHT_NAME, "up", "Memory bank reachable (read-only).", r.now(), latencyMs);
    const why = res.status === 401 || res.status === 403 ? "Hindsight rejected the configured key."
      : res.status === 404 ? "The configured memory bank wasn't found."
      : res.status === 402 ? "Hindsight reports insufficient credits."
      : "Hindsight returned an error.";
    return report("hindsight", HINDSIGHT_NAME, "down", why, r.now(), latencyMs);
  } catch (err: any) {
    return report("hindsight", HINDSIGHT_NAME, "down",
      err && err.message === "timeout" ? "No response from Hindsight in time." : "Couldn't reach Hindsight.", r.now());
  }
}

export type HindsightMemory = { id: string; text: string; type: string | null };
// One flat shape (not a discriminated union) so callers narrow the same way
// with or without strictNullChecks: memories is set iff ok.
export type HindsightRecallResult = {
  ok: boolean;
  memories?: HindsightMemory[];
  reason?: "not_configured" | "invalid_query" | "unavailable";
};

export function clampRecallLimit(limit: unknown): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(n, HINDSIGHT_MAX_LIMIT);
}

export async function hindsightRecall(query: unknown, limit?: unknown, opts?: AdapterOptions): Promise<HindsightRecallResult> {
  const r = resolve(opts);
  const q = typeof query === "string" ? query.replace(/\s+/g, " ").trim().slice(0, HINDSIGHT_MAX_QUERY) : "";
  if (!q) return { ok: false, reason: "invalid_query" };
  const cfg = hindsightConfig(r.env);
  if (!cfg) return { ok: false, reason: "not_configured" };
  const max = clampRecallLimit(limit);
  try {
    const { res } = await timedFetch(r, `${cfg.bankPath}/memories/recall`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: q }),
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = await res.json().catch(() => null);
    const results = body && Array.isArray(body.results) ? body.results : [];
    const memories = results
      .filter((m: any) => m && typeof m.text === "string" && m.text.trim())
      .slice(0, max)
      .map((m: any, i: number) => ({
        id: typeof m.id === "string" || typeof m.id === "number" ? String(m.id) : `r${i}`,
        text: m.text.trim().slice(0, 1000),
        type: typeof m.type === "string" ? m.type.slice(0, 40) : null,
      }));
    return { ok: true, memories };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
