// Command Center shell (Phase 1) — unit + static guard tests.
// Run: node --test tests/command-center/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const FUTURE = path.join(ROOT, "command-center/future");
const lib = require(path.join(FUTURE, "lib.js"));

const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
const MIN = 60 * 1000;

/* ---------------- escapeHtml ---------------- */
test("escapeHtml neutralizes markup from calls/chat/database", () => {
  assert.equal(lib.escapeHtml(`<img src=x onerror="alert('1')">&`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;");
  assert.equal(lib.escapeHtml(null), "");
  assert.equal(lib.escapeHtml(undefined), "");
  assert.equal(lib.escapeHtml(42), "42");
});

/* ---------------- freshness ---------------- */
test("freshness: never loaded is Not connected, never live", () => {
  assert.equal(lib.computeFreshness(undefined, NOW).state, "offline");
  assert.equal(lib.computeFreshness({ lastSuccessAt: 0 }, NOW).state, "offline");
  assert.equal(lib.computeFreshness({ lastSuccessAt: 0, lastError: "HTTP 500", lastAttemptAt: NOW }, NOW).state, "offline");
  assert.equal(lib.computeFreshness({ notConnected: true, lastSuccessAt: NOW }, NOW).state, "offline");
});

test("freshness: first fetch in flight is loading", () => {
  assert.equal(lib.computeFreshness({ lastSuccessAt: 0, inFlight: true }, NOW).state, "loading");
});

test("freshness: recent success is live", () => {
  const f = lib.computeFreshness({ lastSuccessAt: NOW - 30 * 1000, lastAttemptAt: NOW - 30 * 1000 }, NOW);
  assert.equal(f.state, "live");
  assert.equal(lib.freshnessLabel(f), "Live");
});

test("freshness: old success is stale with its age", () => {
  const f = lib.computeFreshness({ lastSuccessAt: NOW - 12 * MIN }, NOW);
  assert.equal(f.state, "stale");
  assert.equal(lib.freshnessLabel(f), "Stale · 12m");
});

test("freshness: a failed refresh after a success is stale immediately (last-known data)", () => {
  const f = lib.computeFreshness({ lastSuccessAt: NOW - 20 * 1000, lastAttemptAt: NOW - 1000, lastError: "HTTP 503" }, NOW);
  assert.equal(f.state, "stale");
});

test("freshness: a later success clears a previous error", () => {
  const f = lib.computeFreshness({ lastSuccessAt: NOW - 1000, lastAttemptAt: NOW - 1000, lastError: null }, NOW);
  assert.equal(f.state, "live");
});

test("worstFreshness surfaces the least-current source", () => {
  const live = { state: "live", age: 0 }, stale = { state: "stale", age: 1 }, off = { state: "offline", age: null };
  assert.equal(lib.worstFreshness([live, stale, live]).state, "stale");
  assert.equal(lib.worstFreshness([live, off, stale]).state, "offline");
  assert.equal(lib.worstFreshness([]).state, "offline");
});

/* ---------------- briefing ---------------- */
test("briefing with no real data says so and invents nothing", () => {
  const b = lib.buildBriefing({});
  assert.equal(b.known, false);
  assert.doesNotMatch(b.text, /\d/);
});

test("briefing mentions only values that actually arrived", () => {
  const b = lib.buildBriefing({ approvals: 2, newLeads: 1 });
  assert.equal(b.known, true);
  assert.equal(b.text, "You have 2 items waiting on your approval, and 1 new lead.");
  assert.doesNotMatch(b.text, /call|follow-up|schedule/);
});

test("briefing handles zero and a capped approvals page honestly", () => {
  assert.match(lib.buildBriefing({ approvals: 0 }).text, /nothing waiting on your approval/);
  assert.match(lib.buildBriefing({ approvals: 10, approvalsAtLeast: true }).text, /at least 10 items/);
  assert.match(lib.buildBriefing({ scheduleToday: 0 }).text, /a clear schedule/);
});

/* ---------------- routing ---------------- */
test("parseRoute accepts known modules and falls back to home", () => {
  const routes = ["home", "mya", "projects", "approvals", "memory", "files", "operations", "devices", "systems"];
  assert.equal(lib.parseRoute("#/projects", routes, "home"), "projects");
  assert.equal(lib.parseRoute("#/Mya", routes, "home"), "mya");
  assert.equal(lib.parseRoute("#/approvals?x=1", routes, "home"), "approvals");
  assert.equal(lib.parseRoute("#/nope", routes, "home"), "home");
  assert.equal(lib.parseRoute("", routes, "home"), "home");
});

/* ---------------- memory helpers ---------------- */
test("categoryCounts groups and sorts callers", () => {
  const rows = [{ category: "lead" }, { category: "vendor" }, { category: "lead" }, {}];
  assert.deepEqual(lib.categoryCounts(rows), [
    { category: "lead", count: 2 }, { category: "uncategorized", count: 1 }, { category: "vendor", count: 1 },
  ]);
});

test("constellation layout is deterministic and stays in bounds", () => {
  const a = lib.layoutConstellation(50, 640, 360);
  const b = lib.layoutConstellation(50, 640, 360);
  assert.deepEqual(a, b);
  for (const p of a) {
    assert.ok(p.x >= 0 && p.x <= 640 && p.y >= 0 && p.y <= 360, JSON.stringify(p));
  }
});

/* ---------------- static guards ---------------- */
const read = (f) => fs.readFileSync(path.join(FUTURE, f), "utf8");

test("new shell never loads or references sample data", () => {
  for (const f of ["index.html", "app.js", "views.js", "shell.js", "data.js", "chat.js", "core.js"]) {
    const src = read(f);
    assert.doesNotMatch(src, /sample-data\.js|SAMPLE_DATA/, f);
  }
});

test("service worker never handles /api/ requests", () => {
  const sw = read("sw.js");
  assert.match(sw, /url\.pathname\.indexOf\("\/api\/"\) === 0\) return;/);
  for (const asset of sw.match(/"\.\/[^"]+"/g)) assert.doesNotMatch(asset, /api/);
});

test("every data source is an existing, unchanged API endpoint", () => {
  const src = read("data.js");
  const urls = [...src.matchAll(/url:\s*"(\/api\/[^"?]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 6);
  for (const u of urls) assert.ok(fs.existsSync(path.join(ROOT, u + ".ts")), u);
});

test("Mya Core CSS is byte-identical to Build 12", () => {
  const build12 = execFileSync("git", ["show", "eaf38c5:command-center/future/styles.css"], { cwd: ROOT, encoding: "utf8" })
    .split("\n").slice(205, 463).join("\n");
  const core = read("core.css").split("\n").slice(8, 266).join("\n");
  assert.equal(core, build12);
});

test("manifest is valid and scoped to the Command Center", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.scope, "/command-center/future/");
  assert.ok(m.start_url.startsWith(m.scope));
  assert.equal(m.display, "standalone");
  for (const icon of m.icons) assert.ok(fs.existsSync(path.join(FUTURE, icon.src)), icon.src);
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
});

/* ---------------- Phase 2: system health, chat metadata ---------------- */
const LIVE = { state: "live", age: 0 };
const STALE = { state: "stale", age: 5 * MIN };

test("system status: nothing is claimed until the Systems check has loaded", () => {
  assert.equal(lib.integrationStatus({ status: "up" }, { state: "offline" }).label, "Not connected");
  assert.equal(lib.integrationStatus({ status: "up" }, { state: "loading" }).label, "Checking");
  assert.equal(lib.integrationStatus({ status: "up" }, null).state, "offline");
});

test("system status: a stale check never says Connected", () => {
  for (const status of ["up", "down", "configured", "not_configured", "not_observable"]) {
    const st = lib.integrationStatus({ status }, STALE);
    assert.equal(st.state, "stale", status);
    assert.doesNotMatch(st.label, /Connected/, status);
  }
});

test("system status: live labels match what the server actually checked", () => {
  assert.deepEqual(lib.integrationStatus({ status: "up" }, LIVE), { state: "up", label: "Connected", cls: "live" });
  assert.equal(lib.integrationStatus({ status: "down" }, LIVE).label, "Down");
  assert.equal(lib.integrationStatus({ status: "configured" }, LIVE).label, "Configured");
  assert.equal(lib.integrationStatus({ status: "not_configured" }, LIVE).label, "Not configured");
});

test("system status: an unreported or unknown system is Not observable, never connected", () => {
  assert.equal(lib.integrationStatus(null, LIVE).state, "not_observable");
  assert.equal(lib.integrationStatus({ status: "bogus" }, LIVE).state, "not_observable");
});

test("systemsDown only reports outages a live check just saw", () => {
  const systems = [{ name: "Hindsight memory", status: "down" }, { name: "Database", status: "up" }];
  assert.deepEqual(lib.systemsDown(systems, LIVE), ["Hindsight memory"]);
  assert.deepEqual(lib.systemsDown(systems, STALE), []);
  assert.deepEqual(lib.systemsDown(null, LIVE), []);
});

test("briefing mentions a down system only when one is known", () => {
  assert.match(lib.buildBriefing({ approvals: 1, systemsDown: ["Hindsight memory"] }).text, /Heads up: Hindsight memory is down\./);
  assert.doesNotMatch(lib.buildBriefing({ approvals: 1 }).text, /down/);
});

test("tool labels are friendly, with a readable fallback for new tools", () => {
  assert.equal(lib.toolLabel("recall_hindsight"), "Searched Hindsight memory");
  assert.equal(lib.toolLabel("some_new_tool"), "Some new tool");
});

test("Executive Mya route follows configuration, never an invented health check", () => {
  const live = { state: "live" };
  assert.equal(lib.executiveMyaRoute({ status: "not_observable" }, live), "hermes");
  assert.equal(lib.executiveMyaRoute({ status: "up" }, live), "hermes");
  assert.equal(lib.executiveMyaRoute({ status: "not_observable" }, { state: "stale" }), "hermes");
  assert.equal(lib.executiveMyaRoute({ status: "not_configured" }, live), "not_configured");
  assert.equal(lib.executiveMyaRoute(undefined, live), "unknown");
  assert.equal(lib.executiveMyaRoute({ status: "not_observable" }, { state: "offline" }), "unknown");
  assert.equal(lib.executiveMyaRoute({ status: "not_observable" }, { state: "loading" }), "loading");
});

test("presence comes only from real signals, in priority order", () => {
  const now = 1_000_000;
  const P = (s) => lib.derivePresence(s, now).state;
  assert.equal(P({ core: "thinking", availability: "unavailable", approvals: 3 }), "thinking");
  assert.equal(P({ core: "speaking" }), "speaking");
  assert.equal(P({ core: "idle", lastOutcome: { ok: false, at: now - 1000 }, approvals: 2 }), "error");
  assert.equal(P({ core: "idle", lastOutcome: { ok: true, at: now - 1000 } }), "completed");
  assert.equal(P({ core: "idle", lastOutcome: { ok: true, at: now - 120000 }, availability: "connected" }), "idle");
  assert.equal(P({ core: "idle", availability: "unavailable", approvals: 2 }), "blocked");
  assert.equal(P({ core: "idle", availability: "unknown" }), "blocked");
  assert.equal(P({ core: "listening", availability: "connected", micOn: true, approvals: 2 }), "listening");
  assert.equal(P({ core: "idle", availability: "connected", approvals: 2 }), "approval");
  // Unknown approvals are never read as zero or as "waiting on you".
  assert.equal(P({ core: "idle", availability: "connected", approvals: null }), "idle");
  assert.match(lib.derivePresence({ core: "idle", availability: "connected", approvals: 1 }, now).detail, /1 approval needs/);
  assert.match(lib.derivePresence({ core: "thinking", pendingText: "x".repeat(200) }, now).detail, /…/);
});

test("presence: waiting and a live voice turn are real states with honest wording", () => {
  const now = 1_000_000;
  const D = (s) => lib.derivePresence(s, now);
  assert.equal(D({ core: "waiting", pendingText: "status?" }).state, "waiting");
  assert.match(D({ core: "waiting" }).detail, /Waiting on her runtime/);
  // Recording outranks resting states but never a request already in flight.
  assert.equal(D({ core: "listening", capturing: true, availability: "connected", approvals: 2 }).state, "listening");
  assert.equal(D({ core: "thinking", capturing: true }).state, "thinking");
  assert.match(D({ core: "listening", capturing: true, transcript: "what's on today" }).detail, /what's on today/);
  assert.match(D({ core: "listening", capturing: true, transcript: "" }).detail, /listening/);
});

test("voice capsule: every phase says what's happening, and hidden means hidden", () => {
  const V = (v) => lib.voiceCapsule(v, NOW);
  assert.equal(V({}).visible, false);
  assert.equal(V({ phase: null }).visible, false);
  assert.equal(V({ phase: "listening" }).action, "send");
  assert.match(V({ phase: "listening", transcript: "hello there" }).detail, /hello there/);
  assert.equal(V({ phase: "speaking", reply: "Sure." }).action, "stop");
  assert.equal(V({ phase: "thinking" }).action, null);
  assert.match(V({ phase: "waiting", startedAt: NOW - 12000 }).detail, /12s/);
  assert.match(V({ phase: "completed", muted: true }).detail, /muted/);
  assert.match(V({ phase: "completed", noAudio: true }).detail, /didn't come through/);
  assert.match(V({ phase: "completed", reply: "All set." }).detail, /All set/);
});

test("voice capsule: failures are specific, and never claim anything was sent elsewhere", () => {
  for (const code of Object.keys(lib.VOICE_ERRORS)) {
    const out = lib.voiceCapsule({ phase: "error", error: code }, NOW);
    assert.equal(out.visible, true);
    assert.ok(out.label && out.detail, code);
  }
  assert.match(lib.voiceCapsule({ phase: "error", error: "unavailable" }, NOW).detail, /Nothing was sent/);
  assert.match(lib.voiceCapsule({ phase: "error", error: "failed" }, NOW).detail, /Nothing was sent to another assistant/);
  // An unknown code falls back to the generic failure, not a blank capsule.
  assert.equal(lib.voiceCapsule({ phase: "error", error: "???" }, NOW).label, lib.VOICE_ERRORS.failed.label);
});

test("voice goes to Executive Mya through the one chat path, never a fixture or a second assistant", () => {
  const voice = read("voice.js");
  assert.match(voice, /MyaChat\.send\(text, \{ voice: true/);
  assert.doesNotMatch(voice, /fetch\(|XMLHttpRequest|\/api\//);
  // The dev simulation is gated to ?dev=1 and never writes to the conversation.
  const sim = voice.slice(voice.indexOf("function simulate()"), voice.indexOf("function typeWords"));
  assert.match(sim, /dev=1/);
  assert.doesNotMatch(sim, /MyaChat\.send|addLine|chat\.line/);
  // Reception stays separate: no phone/Reception endpoints from the voice UI.
  assert.doesNotMatch(voice + read("chat.js"), /mya-call|outbound-call|mya-actions/);
});

test("screen context only describes data that actually loaded", () => {
  const off = lib.buildScreenContext("approvals", { approvals: { state: "offline", data: null } });
  assert.equal(off.label, "Approvals");
  assert.match(off.text, /not connected on this screen/);
  const stale = lib.buildScreenContext("projects", { projects: { state: "stale", data: { projects: [{ project_name: "A", status: "lead" }] } } });
  assert.match(stale.text, /may be stale/);
  assert.match(stale.text, /- A \(lead\)/);
  const many = Array.from({ length: 12 }, (_, i) => ({ project_name: "P" + i }));
  const capped = lib.buildScreenContext("projects", { projects: { state: "live", data: { projects: many } } });
  assert.match(capped.text, /and 4 more/);
  assert.doesNotMatch(capped.text, /P9/);
  // Screens with no data source say only which screen it is.
  assert.equal(lib.buildScreenContext("files", {}).text, "The owner is looking at the Command Center Files screen.");
});

test("systems overview counts statuses; unknown never counts as up", () => {
  const c = lib.countSystemStatuses([{ status: "up" }, { status: "down" }, { status: "weird" }, {}, { status: "not_configured" }]);
  assert.deepEqual(c, { up: 1, down: 1, configured: 0, not_configured: 1, not_observable: 2 });
});

test("audit labels: surfaces and permission levels are never guessed", () => {
  assert.match(lib.surfaceLabel("hermes_mcp"), /Hermes/);
  assert.equal(lib.surfaceLabel("some_new_surface"), "some new surface");
  assert.equal(lib.permissionLabel(0), "Read");
  assert.equal(lib.permissionLabel(2), "Write");
  assert.equal(lib.permissionLabel(3), "Needs approval");
  assert.equal(lib.permissionLabel(undefined), "Unrated");
});

test("the audit read never returns tool input", () => {
  const src = readRoot("api/command-center-data.ts");
  const sel = src.match(/from\("mya_action_log"\)\s*\.select\("([^"]+)"\)\s*\.order/)[1];
  assert.doesNotMatch(sel, /\binput\b|\*/);
});

/* ---------------- Phase 2 static guards ---------------- */
const BASELINE = "59e8c0d";
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("api/ stays at the 12-function cap", () => {
  assert.equal(fs.readdirSync(path.join(ROOT, "api")).filter((f) => f.endsWith(".ts")).length, 12);
});

test("every /api/ URL the shell requests maps to an existing endpoint", () => {
  for (const f of ["data.js", "views.js", "chat.js", "app.js"]) {
    for (const m of read(f).matchAll(/"(\/api\/[a-z-]+)/g)) assert.ok(fs.existsSync(path.join(ROOT, m[1] + ".ts")), f + ": " + m[1]);
  }
});

test("MCP allowlist is exactly get_project, get_client, search_projects", () => {
  const src = readRoot("api/command-center-ask-mya.ts");
  const block = src.match(/const MCP_TOOL_ALIASES[^{]*\{([^}]*)\}/)[1];
  const keys = [...block.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ["get_client", "get_project", "search_projects"]);
});

test("chat has exactly one assistant: Executive Mya, with no Claude fallback", () => {
  const src = readRoot("api/command-center-ask-mya.ts");
  assert.doesNotMatch(src, /callAnthropic|callModel|DEFAULT_MODEL_PROVIDER|SYSTEM_PROMPT/);
  assert.match(src, /if \(!HERMES_BRIDGE_KEY\) \{\s*return res\.status\(503\)\.json\(\{ error: "executive_mya_unavailable"/);
  const chat = readRoot("command-center/future/chat.js");
  assert.doesNotMatch(chat, /provider:\s*"/);
  assert.doesNotMatch(readRoot("command-center/future/index.html"), /provider-toggle/);
});

test("MCP bearer key is compared timing-safe", () => {
  const src = readRoot("api/command-center-ask-mya.ts");
  assert.match(src, /safeStringEqual\(presented, MCP_BRIDGE_KEY\)/);
  assert.doesNotMatch(src, /presented !== MCP_BRIDGE_KEY/);
});

test("reception/phone files are untouched and never reach Command Center integrations", () => {
  const files = fs.readdirSync(path.join(ROOT, "api")).filter((f) => /^mya-.*\.ts$|^outbound-call\.ts$/.test(f));
  assert.ok(files.length >= 4);
  for (const f of files) {
    const rel = "api/" + f;
    const src = readRoot(rel);
    assert.doesNotMatch(src, /lib\/integrations|hindsight|HINDSIGHT_|HERMES_BRIDGE/i, rel);
    const base = execFileSync("git", ["show", `${BASELINE}:${rel}`], { cwd: ROOT, encoding: "utf8" });
    assert.equal(src, base, rel + " differs from the Phase 2 baseline " + BASELINE);
  }
});

test("browser code never references server-side secrets", () => {
  for (const f of fs.readdirSync(FUTURE).filter((x) => /\.(js|html)$/.test(x))) {
    assert.doesNotMatch(read(f), /HINDSIGHT_|HERMES_BRIDGE_KEY|MCP_BRIDGE_KEY|hsk_/, f);
  }
});
