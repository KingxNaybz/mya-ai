#!/usr/bin/env node
/**
 * LOCAL-ONLY preview server for the Command Center shell (Phase 1).
 *
 *   node dev/preview-server.mjs                     # "unconnected" mode (default)
 *   node dev/preview-server.mjs --mode=fixtures     # synthetic layout-review data
 *   node dev/preview-server.mjs --mode=login        # every API call is 401
 *   then open http://127.0.0.1:4173/command-center/future/index.html
 *
 * What it is: a static file server for this repo plus a stand-in for the
 * /api/* routes, so the shell can be reviewed without Vercel, Supabase, or
 * any credentials. It never talks to Production, reads no env vars, and
 * binds to 127.0.0.1 only.
 *
 * Modes:
 *   unconnected  The session probe succeeds (so the shell renders), and every
 *                data endpoint fails -- exactly what the owner would see if the
 *                backend were unreachable: every module shows "Not connected".
 *   fixtures     SYNTHETIC data for design review only. Every page served in
 *                this mode gets an unmissable "SYNTHETIC FIXTURE DATA — NOT
 *                REAL" banner injected by this server (the product code has
 *                no fixture path at all). Contractors always fail (to show a
 *                Not connected block next to live ones), and approvals fail
 *                after the first load (so pressing Refresh shows Stale).
 *   login        Every API route returns 401 -- exercises the login overlay.
 *
 * Phase 2: --hindsight=down (fixtures mode only) makes the synthetic System
 * health report Hindsight as Down, to review that state; default is up.
 *
 * The real login flow is NOT emulated: authentication is only ever decided
 * by the real /api/command-center-settings on Vercel.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT || 4173);
const MODE = (process.argv.find((a) => a.startsWith("--mode=")) || "--mode=unconnected").slice(7);
const HINDSIGHT_FIXTURE = (process.argv.find((a) => a.startsWith("--hindsight=")) || "--hindsight=up").slice(12);
if (!["unconnected", "fixtures", "login"].includes(MODE)) {
  console.error(`Unknown --mode=${MODE} (use unconnected | fixtures | login)`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
};

const BANNER = `<div style="position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;padding:4px 12px;border-radius:999px;background:#e6a23c;color:#1c1300;font:600 11px/1.6 system-ui,sans-serif;letter-spacing:.08em;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.4)">LOCAL PREVIEW · SYNTHETIC FIXTURE DATA — NOT REAL</div>`;

const ago = (mins) => new Date(Date.now() - mins * 60000).toISOString();
let approvalsCalls = 0;

const FIXTURE_PROJECTS = [
  { id: "p1", project_name: "Fixture Project 1", client_name: "Fixture Client A", status: "in_progress", next_action: "Confirm framing inspection date", updated_at: ago(30) },
  { id: "p2", project_name: "Fixture Project 2", client_name: "Fixture Client B", status: "estimating", next_action: "Send revised estimate", updated_at: ago(300) },
  { id: "p3", project_name: "Fixture Project 3", client_name: null, status: "lead", next_action: null, outstanding_decisions: "Scope: deck vs. patio", updated_at: ago(2000) },
];

function sys(id, name, status, detail, extra) {
  return { id, name, status, detail, checkedAt: new Date().toISOString(), latencyMs: status === "up" ? 84 : null, ...(extra || {}) };
}

function fixtures(route, url) {
  switch (route) {
    case "/api/command-center-data?type=systems":
      return { generatedAt: new Date().toISOString(), systems: [
        sys("supabase", "Database (Supabase)", "up", "Business data storage — responding."),
        sys("anthropic", "Claude (background)", "configured", "Caller classification only. Not a Command Center assistant"),
        sys("voice", "Mya's voice (ElevenLabs)", "configured", "Spoken chat replies"),
        sys("phone", "Phone system (Twilio)", "not_configured", "Calls and SMS — not configured."),
        sys("hermes", "Mya runtime (Hermes VPS)", "not_observable", "Configured here, but Hermes exposes no documented read-only health check this dashboard can use."),
        sys("telegram", "Telegram", "not_observable", "Only visible inside the Hermes runtime."),
        sys("router", "Local Qwen router", "not_observable", "Only visible inside the Hermes runtime."),
        HINDSIGHT_FIXTURE === "down"
          ? sys("hindsight", "Hindsight memory", "down", "No response from Hindsight in time.")
          : sys("hindsight", "Hindsight memory", "up", "Memory bank reachable (read-only)."),
        sys("mcp", "Hermes MCP read bridge", "configured", "Read-only allowlist: get_project, get_client, search_projects", { lastActivityAt: ago(95) }),
        sys("windows", "Windows agent", "not_observable", "No live heartbeat — last seen when it last asked Mya something.", { lastActivityAt: ago(60 * 26) }),
        sys("houzz", "Houzz Pro", "not_configured", "No Houzz adapter in this phase."),
      ] };
    case "/api/command-center-memory?type=hindsight":
      return { memories: [
        { id: "h1", text: `Synthetic Hindsight memory matching “${url.searchParams.get("q") || ""}” — fixture only.`, type: "world" },
        { id: "h2", text: "Synthetic: owner prefers Tuesday site walks — fixture only.", type: "experience" },
      ] };
    case "/api/command-center-projects?type=search": {
      const q = (url.searchParams.get("q") || "").toLowerCase();
      return { projects: FIXTURE_PROJECTS.filter((p) => (p.project_name + " " + (p.client_name || "")).toLowerCase().includes(q)), limit: 25 };
    }
    case "/api/command-center-projects?type=detail": {
      const p = FIXTURE_PROJECTS.find((x) => x.id === url.searchParams.get("id"));
      if (!p) return null;
      return {
        project: { ...p, project_type: "Remodel", current_estimate: 48250, notes: "Synthetic fixture project — not real." },
        estimateItems: p.id === "p3" ? [] : [
          { id: "e1", category: "Framing", description: "Wall framing (fixture)", quantity: 120, unit: "lf", unit_cost: 18, line_total: 2160 },
          { id: "e2", category: "Drywall", description: "Hang + finish (fixture)", quantity: 40, unit: "sheet", unit_cost: 55, line_total: 2200 },
        ],
        directCost: p.id === "p3" ? 0 : 4360,
        upcoming: p.id === "p1" ? [{ title: "Framing inspection (fixture)", scheduled_at: new Date(Date.now() + 2 * 864e5).toISOString(), notes: null }] : [],
      };
    }
    case "/api/command-center-approvals?status=recent":
      return { approvals: [
        { id: "fx-9", title: "Text you when drywall is delivered", status: "approved", requested_at: ago(3000), resolved_at: ago(2900), action_type: "notify_owner" },
        { id: "fx-8", title: "Send warranty letter to Fixture Client B", status: "declined", requested_at: ago(5000), resolved_at: ago(4700), action_type: "send_to_customer" },
      ] };
    case "/api/command-center-settings":
      return { settings: { owner_name: "Preview", footer_tagline: null, notify_enabled: true, notify_phone: null } };
    case "/api/command-center-data":
      return {
        generatedAt: new Date().toISOString(),
        todaysCalls: { value: 4, error: null, recent: [] },
        newLeads: { value: 2, error: null, recent: [
          { name: "Fixture Lead A", interest: "Kitchen remodel", source: "Phone", receivedAt: ago(42) },
          { name: "Fixture Lead B", interest: "Deck addition", source: "Website", receivedAt: ago(190) },
        ] },
        recentActivity: [
          { time: ago(12), text: "Fixture Caller A called about a roof inspection." },
          { time: ago(55), text: "New project intake: Fixture Lead B (Deck addition)." },
          { time: ago(140), text: "Fixture Caller C called about an estimate follow-up." },
        ],
        memoryInsights: { totalContactsRemembered: 37, recurringCustomers: 9, notesLoggedThisWeek: 5 },
        schedule: [
          { time: "10:30 AM", label: "Site walk — Fixture Project 1" },
          { time: "Today", label: "Send revised estimate — Fixture Project 2" },
        ],
        workingNow: ["Added follow-up for Fixture Lead A", "Updated next action on Fixture Project 2", "Remembered a fixture fact"],
        services: [
          { name: "Phone system (Twilio)", detail: "Inbound/outbound calling", connected: true },
          { name: "Voice (ElevenLabs)", detail: "Phone agent voice", connected: true },
          { name: "Database (Supabase)", detail: "Business data storage", connected: true },
          { name: "Mya's brain (Anthropic)", detail: "Claude Sonnet 5", connected: false },
        ],
        callerDirectory: [
          { category: "lead" }, { category: "lead" }, { category: "existing_client" }, { category: "vendor" }, { category: "wrong_number_or_spam" },
        ],
      };
    case "/api/command-center-approvals":
      approvalsCalls += 1;
      if (approvalsCalls > 1) return null; // later refreshes fail -> Stale
      return { approvals: [
        { id: "fx-1", title: "Send estimate to Fixture Lead A", detail: "Kitchen remodel — synthetic example.", status: "pending", requested_at: ago(35), action_type: "send_to_customer" },
        { id: "fx-2", title: "Text you when the permit clears", detail: "Fixture Project 1.", status: "pending", requested_at: ago(26 * 60), action_type: "notify_owner" },
      ] };
    case "/api/command-center-projects":
      return { projects: FIXTURE_PROJECTS };
    case "/api/command-center-projects?type=alerts":
      return { alerts: [{ message: '"Text you when the permit clears" has been waiting for your approval for over 24 hours.', severity: "warning" }] };
    case "/api/command-center-memory":
      return { facts: Array.from({ length: 18 }, (_, i) => ({ id: "f" + i, fact: `Synthetic fixture fact #${i + 1} for layout review.`, created_at: ago(i * 300 + 5) })) };
    case "/api/command-center-followups":
      return { openCount: 3 };
    case "/api/command-center-contractors":
      return null; // always fails -> Not connected block beside live ones
    default:
      return undefined;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function handleApi(req, res, url) {
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const route = url.pathname + (type ? "?type=" + type : status ? "?status=" + status : "");
  if (MODE === "login") return sendJson(res, 401, { error: "Unauthorized" });

  if (url.pathname === "/api/command-center-settings") {
    if (req.method === "POST") return sendJson(res, 200, { ok: true }); // logout / no-op; real login only exists on Vercel
    return sendJson(res, 200, MODE === "fixtures" ? fixtures(route) : { settings: null });
  }
  if (url.pathname === "/api/command-center-ask-mya" && req.method === "POST") {
    return sendJson(res, 503, { error: "executive_mya_unavailable", message: "Local preview — Executive Mya isn't connected here, so she can't answer." });
  }
  if (url.pathname === "/api/command-center-approvals" && req.method === "POST") {
    return sendJson(res, 503, { error: "Local preview — approvals can't be resolved here." });
  }
  if (MODE === "unconnected") return sendJson(res, 503, { error: "Local preview: not connected" });

  const body = fixtures(route, url);
  if (body === undefined) return sendJson(res, 404, { error: "No such preview route" });
  if (body === null) return sendJson(res, 503, { error: "Fixture: this source is failing on purpose" });
  return sendJson(res, 200, body);
}

function serveStatic(res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(ROOT, "." + rel);
  if (!file.startsWith(ROOT + path.sep) || file.includes(`${path.sep}.git${path.sep}`) || path.basename(file).startsWith(".env")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    let out = buf;
    if (MODE === "fixtures" && type.startsWith("text/html")) out = Buffer.from(buf.toString("utf8").replace("<body>", "<body>" + BANNER));
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    res.end(out);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/__preview/reset") { approvalsCalls = 0; return sendJson(res, 200, { ok: true }); } // lets a reviewer (or the checks) replay the Live -> Stale sequence
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  if (url.pathname === "/" ) { res.writeHead(302, { Location: "/command-center/future/index.html" }); return res.end(); }
  return serveStatic(res, url);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Mya Command Center preview (${MODE}) → http://127.0.0.1:${PORT}/command-center/future/index.html`);
  console.log(`Classic dashboard (unchanged)      → http://127.0.0.1:${PORT}/command-center/index.html`);
});
