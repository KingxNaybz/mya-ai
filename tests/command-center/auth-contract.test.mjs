// Command Center authentication contract — regression guards.
// Locks in the Executive dashboard login/session behavior that is live and
// confirmed working: one human password (DASHBOARD_PASSWORD), an independent
// SESSION_SIGNING_SECRET, the mya_session cookie, login throttling, and the
// single isCommandCenterAuthenticated gate on every command-center endpoint.
// Secrets used here are random per run -- never real values.
// Run: node --test tests/command-center/   (Node strips the TS types)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const session = await import(path.join(ROOT, "lib/session.ts"));

const SETTINGS = "api/command-center-settings.ts";
const settingsSrc = readRoot(SETTINGS);
const fakeSecret = () => "test-only-" + randomBytes(16).toString("hex");

/* ---------------- Password variable + comparison ---------------- */
test("DASHBOARD_PASSWORD is the only human password, read once and trimmed", () => {
  assert.match(settingsSrc, /const DASHBOARD_PASSWORD = \(process\.env\.DASHBOARD_PASSWORD \|\| ""\)\.trim\(\);/);
  assert.match(settingsSrc, /typeof body\.password === "string" \? body\.password\.trim\(\) : ""/);
  assert.match(settingsSrc, /!DASHBOARD_PASSWORD \|\| !password \|\| !safeStringEqual\(password, DASHBOARD_PASSWORD\)/);
  // No second password variable anywhere in the API or lib code.
  for (const dir of ["api", "lib"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => x.endsWith(".ts"))) {
      const rel = dir + "/" + f;
      const envNames = [...readRoot(rel).matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
      for (const name of envNames) {
        if (/PASSWORD|PASSPHRASE|PASSCODE/.test(name)) assert.equal(name, "DASHBOARD_PASSWORD", rel);
      }
      if (rel !== SETTINGS) assert.doesNotMatch(readRoot(rel), /process\.env\.DASHBOARD_PASSWORD/, rel);
    }
  }
});

test("password comparison is timing-safe and exact after trimming", () => {
  assert.equal(session.safeStringEqual("abc", "abc"), true);
  assert.equal(session.safeStringEqual("abc", "abd"), false);
  assert.equal(session.safeStringEqual("abc", "abc "), false); // trimming happens before the compare, not inside it
  assert.equal(session.safeStringEqual("", "x"), false);
  // No plain ==/=== on the password itself (`typeof body.password === "string"` is fine).
  assert.doesNotMatch(settingsSrc, /(?<!\.)\bpassword\s*[!=]==?|[!=]==?\s*password\b|DASHBOARD_PASSWORD\s*[!=]==?|[!=]==?\s*DASHBOARD_PASSWORD/);
});

/* ---------------- Session signing ---------------- */
test("sessions require SESSION_SIGNING_SECRET and it is never the password", () => {
  assert.match(settingsSrc, /const SESSION_SIGNING_SECRET = process\.env\.SESSION_SIGNING_SECRET \|\| "";/);
  assert.match(settingsSrc, /if \(!SESSION_SIGNING_SECRET\) \{[\s\S]*?status\(503\)/);
  assert.match(settingsSrc, /createSessionToken\(SESSION_SIGNING_SECRET\)/);
  assert.doesNotMatch(settingsSrc, /createSessionToken\(DASHBOARD_PASSWORD\)|SESSION_SIGNING_SECRET \|\| DASHBOARD_PASSWORD|DASHBOARD_PASSWORD \|\| SESSION_SIGNING_SECRET/);
  assert.doesNotMatch(readRoot("lib/session.ts"), /process\.env\.DASHBOARD_PASSWORD/);
});

test("a signed session verifies only with the same secret, and fails closed without one", () => {
  const secret = fakeSecret();
  const token = session.createSessionToken(secret);
  assert.equal(session.verifySessionToken(token, secret), true);
  assert.equal(session.verifySessionToken(token, fakeSecret()), false);
  assert.equal(session.verifySessionToken(token, ""), false);
  assert.equal(session.verifySessionToken(session.createSessionToken(""), ""), false);
  assert.equal(session.verifySessionToken(undefined, secret), false);
  assert.equal(session.verifySessionToken("not-a-token", secret), false);
  const [payload, sig] = token.split(".");
  assert.equal(session.verifySessionToken(`${Number(payload) + 1}.${sig}`, secret), false, "tampered expiry");
  assert.doesNotMatch(token, new RegExp(secret), "token never carries the secret");
});

test("sessions last 24 hours and expire after that", () => {
  const secret = fakeSecret();
  const before = Date.now();
  const expires = Number(session.createSessionToken(secret).split(".")[0]);
  const DAY = 24 * 60 * 60 * 1000;
  assert.ok(expires >= before + DAY && expires <= Date.now() + DAY, "expiry is 24h from issue");
});

/* ---------------- Cookie ---------------- */
test("mya_session cookie is HttpOnly, Secure, SameSite=Strict, Path=/, 24h", () => {
  assert.equal(session.SESSION_COOKIE_NAME, "mya_session");
  assert.equal(session.sessionCookieHeader("t.s"), "mya_session=t.s; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400");
  assert.equal(session.clearSessionCookieHeader(), "mya_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  assert.equal(session.extractSessionCookie("a=1; mya_session=t.s; b=2"), "t.s");
  assert.equal(session.extractSessionCookie("xmya_session=t.s"), null);
});

/* ---------------- Gate ---------------- */
test("the gate accepts a valid session cookie or desktop key, nothing else", () => {
  const signing = fakeSecret();
  const apiKey = fakeSecret();
  const saved = { s: process.env.SESSION_SIGNING_SECRET, k: process.env.COMMAND_CENTER_API_KEY };
  try {
    process.env.SESSION_SIGNING_SECRET = signing;
    process.env.COMMAND_CENTER_API_KEY = apiKey;
    const cookie = "mya_session=" + session.createSessionToken(signing);
    assert.equal(session.commandCenterAuthMethod({ headers: { cookie } }), "session");
    assert.equal(session.commandCenterAuthMethod({ headers: { "x-command-center-key": apiKey } }), "api_key");
    assert.equal(session.isCommandCenterAuthenticated({ headers: {} }), false);
    assert.equal(session.isCommandCenterAuthenticated({ headers: { cookie: "mya_session=" + session.createSessionToken(fakeSecret()) } }), false);
    assert.equal(session.isCommandCenterAuthenticated({ headers: { "x-command-center-key": fakeSecret() } }), false);

    // Missing SESSION_SIGNING_SECRET: even a previously valid cookie is refused.
    delete process.env.SESSION_SIGNING_SECRET;
    assert.equal(session.isCommandCenterAuthenticated({ headers: { cookie } }), false);
    // Missing COMMAND_CENTER_API_KEY: an empty header never matches.
    delete process.env.COMMAND_CENTER_API_KEY;
    assert.equal(session.isCommandCenterAuthenticated({ headers: { "x-command-center-key": "" } }), false);
  } finally {
    for (const [name, v] of [["SESSION_SIGNING_SECRET", saved.s], ["COMMAND_CENTER_API_KEY", saved.k]]) {
      if (v === undefined) delete process.env[name];
      else process.env[name] = v;
    }
  }
});

test("every api/command-center-*.ts endpoint uses the shared gate", () => {
  const files = fs.readdirSync(path.join(ROOT, "api")).filter((f) => /^command-center-.*\.ts$/.test(f));
  assert.ok(files.length >= 8);
  for (const f of files) {
    const src = readRoot("api/" + f);
    assert.match(src, /import \{[^}]*\bisCommandCenterAuthenticated\b[^}]*\} from "\.\.\/lib\/session"/, f);
    assert.match(src, /if \(!isCommandCenterAuthenticated\(req\)\) \{\s*return res\.status\(401\)/, f);
    // No endpoint rolls its own check against the gate's secrets.
    if (f !== "command-center-settings.ts") assert.doesNotMatch(src, /process\.env\.(SESSION_SIGNING_SECRET|COMMAND_CENTER_API_KEY)/, f);
  }
});

test("settings: only login and logout run before the gate, and both are documented", () => {
  const handler = settingsSrc.slice(settingsSrc.indexOf("export default async function handler"));
  const post = handler.slice(handler.indexOf('if (req.method === "POST")'));
  const logoutAt = post.indexOf("if (body.logout === true)");
  const loginAt = post.indexOf("if (body.login === true)");
  const gateAt = post.indexOf("if (!isCommandCenterAuthenticated(req))");
  assert.ok(logoutAt > 0 && loginAt > logoutAt && gateAt > loginAt, "logout, then login, then the gate");
  // Nothing else in the POST path runs before the gate.
  const preGate = post.slice(0, gateAt).replace(/if \(body\.logout === true\)[\s\S]*?\n    \}\n/, "").replace(/if \(body\.login === true\)[\s\S]*?\n    \}\n/, "");
  assert.doesNotMatch(preGate, /supabase|update\(/);
  // GET is gated before any query.
  const get = handler.slice(handler.indexOf('if (req.method === "GET")'), handler.indexOf('if (req.method === "POST")'));
  assert.ok(get.indexOf("isCommandCenterAuthenticated(req)") < get.indexOf("supabase"));
  // Logout just clears the cookie; login issues one only after the password + signing checks.
  assert.match(post.slice(logoutAt, loginAt), /clearSessionCookieHeader\(\)/);
  const login = post.slice(loginAt, gateAt);
  assert.ok(login.indexOf("safeStringEqual(password, DASHBOARD_PASSWORD)") < login.indexOf("sessionCookieHeader(token)"));
  assert.ok(login.indexOf("if (!SESSION_SIGNING_SECRET)") < login.indexOf("sessionCookieHeader(token)"));
  // The exception is spelled out in the file header.
  assert.match(settingsSrc, /\{ login: true \} and \{ logout: true \} branches are the\s+\* deliberate exception/);
});

/* ---------------- Throttling ---------------- */
test("login throttling defaults stay 5 attempts / 15-minute window / 15-minute lockout", () => {
  assert.match(settingsSrc, /LOGIN_MAX_ATTEMPTS = parseInt\(process\.env\.LOGIN_MAX_ATTEMPTS \|\| "", 10\) \|\| 5;/);
  assert.match(settingsSrc, /LOGIN_WINDOW_MS = \(parseInt\(process\.env\.LOGIN_WINDOW_MINUTES \|\| "", 10\) \|\| 15\) \* 60 \* 1000;/);
  assert.match(settingsSrc, /LOGIN_LOCKOUT_MS = \(parseInt\(process\.env\.LOGIN_LOCKOUT_MINUTES \|\| "", 10\) \|\| 15\) \* 60 \* 1000;/);
});

test("login throttling runs before the password check and fails closed", () => {
  const login = settingsSrc.slice(settingsSrc.indexOf("if (body.login === true)"));
  assert.ok(login.indexOf("checkLoginLock(") < login.indexOf("safeStringEqual(password"));
  assert.match(login, /lockState === "unavailable"\) \{\s*return res\.status\(503\)/);
  assert.match(login, /lockState === "locked"\) \{\s*return res\.status\(429\)/);
  assert.match(login, /if \(!recorded\) \{\s*return res\.status\(503\)/);
  assert.match(settingsSrc, /failedCount >= LOGIN_MAX_ATTEMPTS \? new Date\(now \+ LOGIN_LOCKOUT_MS\)/);
});

test("submitted passwords are never logged or stored", () => {
  for (const m of settingsSrc.matchAll(/console\.(log|error|warn|info)\(([^;]*)\);/g)) {
    assert.doesNotMatch(m[2], /password|body|DASHBOARD_PASSWORD|SESSION_SIGNING_SECRET|cookie/i, m[0]);
  }
  const upsert = settingsSrc.match(/mya_login_attempts"\)\.upsert\(\{([\s\S]*?)\}\)/)[1];
  assert.doesNotMatch(upsert, /password/i);
});

/* ---------------- Secret exposure ---------------- */
test("browser/client code never references the dashboard password or signing secret", () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const clientFiles = [...walk(path.join(ROOT, "command-center")), path.join(ROOT, "dev/preview-server.mjs")]
    .filter((f) => /\.(js|mjs|html|css|json|webmanifest)$/.test(f));
  assert.ok(clientFiles.length > 5);
  for (const f of clientFiles) {
    assert.doesNotMatch(fs.readFileSync(f, "utf8"), /DASHBOARD_PASSWORD|SESSION_SIGNING_SECRET/, path.relative(ROOT, f));
  }
});

test(".env.example files hold placeholders only for auth secrets", () => {
  for (const rel of [".env.example", "desktop-app/.env.example"]) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    for (const line of readRoot(rel).split("\n")) {
      const m = line.match(/^\s*(DASHBOARD_PASSWORD|SESSION_SIGNING_SECRET|COMMAND_CENTER_API_KEY)\s*=\s*(.*)$/);
      if (m) assert.match(m[2].trim(), /^$|^replace-with-/, `${rel}: ${m[1]} must be a placeholder`);
    }
  }
});
