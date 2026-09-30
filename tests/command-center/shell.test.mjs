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
