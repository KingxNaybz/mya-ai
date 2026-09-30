// Watch Mya — the computer-control contract (lib/computer.ts).
// Run: node --test tests/command-center/   (Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const c = await import(path.join(ROOT, "lib/computer.ts"));
const T = "2026-09-30T15:00:00.000Z";
const withTask = (over = {}) => ({ ...c.emptySession(), taskId: "t1", task: "Update the estimate", status: "working", control: "mya", ...over });

test("only Mya control allows input; user and paused never do", () => {
  assert.equal(c.mayIssueInput("mya"), true);
  for (const v of ["user", "paused", null, undefined, "", "MYA", "shared"]) assert.equal(c.mayIssueInput(v), false, String(v));
  assert.equal(c.emptySession().control, "paused");
});

test("Take Control and Stop are accepted from every state", () => {
  for (const control of c.CONTROLS) {
    for (const status of c.TASK_STATUSES) {
      const take = c.applyOwnerAction(withTask({ control, status }), "take", T);
      assert.ok(take.ok); assert.equal(take.session.control, "user");
      const stop = c.applyOwnerAction(withTask({ control, status }), "stop", T);
      assert.ok(stop.ok); assert.equal(stop.session.status, "stopped");
      assert.equal(c.mayIssueInput(stop.session.control), false);
    }
  }
});

test("owner transitions: pause, resume, return", () => {
  const paused = c.applyOwnerAction(withTask(), "pause", T);
  assert.equal(paused.session.control, "paused");
  assert.equal(paused.session.controlChangedBy, "owner");
  assert.equal(paused.event.kind, "control");
  assert.equal(c.applyOwnerAction(paused.session, "resume", T).session.control, "mya");
  // You have control: resume doesn't apply, return does.
  const mine = withTask({ control: "user" });
  assert.equal(c.applyOwnerAction(mine, "resume", T).ok, false);
  assert.equal(c.applyOwnerAction(mine, "pause", T).ok, false);
  assert.equal(c.applyOwnerAction(mine, "return", T).session.control, "mya");
  // Nothing to hand back without a live task.
  assert.equal(c.applyOwnerAction(c.emptySession(), "return", T).ok, false);
  assert.equal(c.applyOwnerAction(withTask({ status: "stopped", control: "paused" }), "resume", T).ok, false);
  assert.equal(c.applyOwnerAction(withTask(), "hack", T).ok, false);
});

test("an agent can yield control but never take it", () => {
  assert.equal(c.validateReport({ control: "mya" }).ok, false);
  assert.equal(c.validateReport({ control: "paused" }).ok, false);
  const y = c.validateReport({ control: "user" });
  assert.ok(y.ok);
  const s = c.applyAgentReport(withTask(), y.report, T);
  assert.equal(s.control, "user");
  assert.equal(s.controlChangedBy, "agent");
  // A report without control leaves the owner's decision alone.
  const owner = withTask({ control: "paused" });
  assert.equal(c.applyAgentReport(owner, c.validateReport({ step: "x", status: "working" }).report, T).control, "paused");
});

test("a new task starts without control; a stopped task stays stopped", () => {
  const s = c.applyAgentReport(withTask({ control: "mya" }), c.validateReport({ taskId: "t2", task: "New" }).report, T);
  assert.equal(s.control, "paused");
  assert.equal(s.status, "working");
  assert.equal(s.startedAt, T);
  const stopped = withTask({ status: "stopped", control: "paused" });
  assert.equal(c.applyAgentReport(stopped, c.validateReport({ status: "working" }).report, T).status, "stopped");
  assert.equal(c.applyAgentReport(stopped, c.validateReport({ taskId: "t3", status: "working" }).report, T).status, "working");
});

test("reports: frames are small raster data URLs only; text is capped", () => {
  assert.ok(c.validateReport({ frame: "data:image/jpeg;base64,AAAA" }).ok);
  assert.equal(c.validateReport({ frame: "data:image/svg+xml;base64,AAAA" }).ok, false);
  assert.equal(c.validateReport({ frame: "https://example.test/a.png" }).ok, false);
  assert.equal(c.validateReport({ frame: "data:image/png;base64," + "A".repeat(c.MAX_FRAME_CHARS) }).ok, false);
  assert.equal(c.validateReport({ status: "exploding" }).ok, false);
  const r = c.validateReport({ step: "x".repeat(1000), events: Array.from({ length: 50 }, () => ({ kind: "step", text: "y" })).concat([{ kind: "control", text: "z" }]) }).report;
  assert.equal(r.step.length, 300);
  assert.equal(r.events.length, c.MAX_EVENTS_PER_REPORT);
  assert.ok(r.events.every((e) => e.kind !== "control"), "agents can't forge control events");
  assert.equal(c.validateReport(null).ok, false);
});

test("the agent is told exactly whether it may issue input", () => {
  assert.deepEqual(c.agentInstructions(withTask({ control: "user" })), { control: "user", mayIssueInput: false, status: "working", taskId: "t1" });
  assert.equal(c.agentInstructions(withTask()).mayIssueInput, true);
});

test("connection: live, stale, offline from the heartbeat", () => {
  const now = Date.parse(T);
  assert.equal(c.connectionState(null, now), "offline");
  assert.equal(c.connectionState(new Date(now - 3000).toISOString(), now), "live");
  assert.equal(c.connectionState(new Date(now - 60000).toISOString(), now), "stale");
  assert.equal(c.connectionState(new Date(now - 600000).toISOString(), now), "offline");
  assert.equal(c.connectionState("garbage", now), "offline");
});

test("row mapping round-trips and rejects unknown states", () => {
  const s = withTask({ app: "Chrome · Houzz Pro", step: "Opening estimate" });
  assert.deepEqual(c.sessionFromRow(c.rowFromSession(s)), s);
  const odd = c.sessionFromRow({ control: "root", status: "??" });
  assert.equal(odd.control, "paused");
  assert.equal(odd.status, "idle");
});

test("API: owner controls need the browser session, reports need the agent key; reports never grant control", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(path.join(ROOT, "api/command-center-data.ts"), "utf8");
  assert.match(src, /type === "computer-control"\) \{\s*if \(method !== "session"\)/);
  assert.match(src, /if \(method !== "api_key"\) return res\.status\(403\)/);
  const report = src.slice(src.indexOf("async function handleComputerReport"), src.indexOf("export default async function handler"));
  const base = report.slice(report.indexOf("const base"), report.indexOf("};", report.indexOf("const base")));
  assert.doesNotMatch(base, /control/, "the unconditional write must not touch control");
  // Every control write in a report is conditional and only restricts.
  const writes = [...report.matchAll(/update\(\{ control: "(\w+)"[^)]*\)\s*\.eq\("device_id", COMPUTER_DEVICE\)\.(eq|neq)\("control", "(\w+)"\)/g)].map((m) => m.slice(1).join(" "));
  assert.deepEqual(writes, ["paused eq mya", "user neq user"]);
  assert.doesNotMatch(report, /control: "mya"/);
});
