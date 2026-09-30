// Command Center Phase 2 — read-only external adapters (lib/integrations.ts).
// Run: node --test tests/command-center/   (Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const integrations = await import(path.join(ROOT, "lib/integrations.ts"));
const { hermesStatus, hindsightHealth, hindsightRecall, clampRecallLimit } = integrations;

const NOW = Date.UTC(2026, 8, 30, 15, 0, 0);
const now = () => NOW;
const KEY = "hsk_test_secret_value_123";
const ENV = { HINDSIGHT_API_URL: "https://hindsight.example.test/", HINDSIGHT_API_KEY: KEY, HINDSIGHT_BANK_ID: "mya" };

function recordingFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  fn.calls = calls;
  return fn;
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status) => ({ ok: false, status, json: async () => ({ error: "upstream detail " + KEY }) });

/* ---------------- Hermes ---------------- */
test("hermes: no key is Not configured; a key alone is Not observable, never up", () => {
  const none = hermesStatus({ env: {}, now });
  assert.equal(none[0].status, "not_configured");
  const withKey = hermesStatus({ env: { HERMES_BRIDGE_KEY: "x" }, now });
  assert.equal(withKey[0].status, "not_observable");
  for (const r of withKey) assert.notEqual(r.status, "up");
  assert.deepEqual(withKey.map((r) => r.id), ["hermes", "telegram", "router"]);
  assert.equal(withKey[1].status, "not_observable");
  assert.equal(withKey[0].checkedAt, new Date(NOW).toISOString());
});

/* ---------------- Hindsight health ---------------- */
test("hindsight: missing or unsafe config makes no request", async () => {
  const f = recordingFetch(() => ok({}));
  for (const env of [
    {},
    { ...ENV, HINDSIGHT_API_KEY: "" },
    { ...ENV, HINDSIGHT_BANK_ID: "" },
    { ...ENV, HINDSIGHT_API_URL: "http://plain-http.example.test" }, // never send the key over http
    { ...ENV, HINDSIGHT_BANK_ID: "../../admin" },
  ]) {
    assert.equal((await hindsightHealth({ env, fetch: f, now })).status, "not_configured");
    assert.equal((await hindsightRecall("anything", 5, { env, fetch: f, now })).reason, "not_configured");
  }
  assert.equal(f.calls.length, 0);
});

test("hindsight health: documented read-only bank GET with Bearer auth", async () => {
  const f = recordingFetch(() => ok({ bank_id: "mya" }));
  const r = await hindsightHealth({ env: ENV, fetch: f, now });
  assert.equal(r.status, "up");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://hindsight.example.test/v1/default/banks/mya");
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer " + KEY);
});

test("hindsight health: rejected key / missing bank / errors are Down with generic text", async () => {
  for (const [status, re] of [[401, /rejected/], [404, /bank/], [500, /error/]]) {
    const r = await hindsightHealth({ env: ENV, fetch: recordingFetch(() => fail(status)), now });
    assert.equal(r.status, "down");
    assert.match(r.detail, re);
    assert.ok(!JSON.stringify(r).includes(KEY), "secret leaked for " + status);
  }
});

test("hindsight health: a hung upstream times out as Down", async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted " + KEY))));
  const r = await hindsightHealth({ env: ENV, fetch: hang, now, timeoutMs: 20 });
  assert.equal(r.status, "down");
  assert.match(r.detail, /in time/);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

/* ---------------- Hindsight recall ---------------- */
test("hindsight recall: posts only the query to the documented recall path and normalizes results", async () => {
  const f = recordingFetch(() => ok({ results: [
    { id: "m1", text: "  Owner prefers Tuesday walkthroughs ", type: "experience", entities: ["secret-entity"] },
    { id: 2, text: "Second", type: null },
    { text: "" },
    null,
  ], trace: { internal: KEY } }));
  const r = await hindsightRecall("  tuesday   walkthroughs ", 10, { env: ENV, fetch: f, now });
  assert.equal(f.calls[0].url, "https://hindsight.example.test/v1/default/banks/mya/memories/recall");
  assert.equal(f.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { query: "tuesday walkthroughs" });
  assert.deepEqual(r, { ok: true, memories: [
    { id: "m1", text: "Owner prefers Tuesday walkthroughs", type: "experience" },
    { id: "2", text: "Second", type: null },
  ] });
  assert.ok(!JSON.stringify(r).includes(KEY), "trace/secret must not pass through");
});

test("hindsight recall: empty query is rejected without a request; limit is clamped", async () => {
  const f = recordingFetch(() => ok({ results: Array.from({ length: 50 }, (_, i) => ({ id: "x" + i, text: "t" + i })) }));
  assert.equal((await hindsightRecall("   ", 5, { env: ENV, fetch: f, now })).reason, "invalid_query");
  assert.equal((await hindsightRecall(42, 5, { env: ENV, fetch: f, now })).reason, "invalid_query");
  assert.equal(f.calls.length, 0);
  const r = await hindsightRecall("q", 999, { env: ENV, fetch: f, now });
  assert.equal(r.memories.length, 20);
  assert.equal(clampRecallLimit("abc"), 10);
  assert.equal(clampRecallLimit(0), 10);
  assert.equal(clampRecallLimit(3), 3);
});

test("hindsight recall: upstream failure is 'unavailable', never upstream text", async () => {
  const r = await hindsightRecall("q", 5, { env: ENV, fetch: recordingFetch(() => fail(402)), now });
  assert.deepEqual(r, { ok: false, reason: "unavailable" });
});

/* ---------------- read-only by construction ---------------- */
test("the adapter module exposes no write/retain/delete capability", () => {
  const names = Object.keys(integrations);
  for (const n of names) assert.doesNotMatch(n, /retain|write|delete|update|create|reflect|put/i, n);
  const src = fs.readFileSync(path.join(ROOT, "lib/integrations.ts"), "utf8");
  assert.doesNotMatch(src, /method:\s*"(PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(src, /\/memories"|\/memories`(?!\/recall)/, "only the recall sub-path may be POSTed");
});
