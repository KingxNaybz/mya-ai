/**
 * MyaData — the Command Center's single read path to its data sources.
 *
 * Every source is one EXISTING endpoint (no backend change in Phase 1),
 * fetched with the same session cookie the classic dashboard uses. Each
 * source keeps its own freshness record (last success, last attempt, last
 * error), which is what drives the Live / Stale / Not connected tags --
 * nothing renders as live unless a fetch for it actually succeeded.
 *
 * A 401 from any source means the session ended: MyaEvents "auth.expired"
 * is emitted and app.js shows the login overlay (fail closed, same as
 * before). Views never fetch on their own; they read from here and
 * re-render on "data.changed".
 */
(function (global) {
  "use strict";

  var SOURCES = {
    data:        { url: "/api/command-center-data",                label: "Business snapshot" },
    approvals:   { url: "/api/command-center-approvals",           label: "Approvals" },
    projects:    { url: "/api/command-center-projects",            label: "Projects" },
    alerts:      { url: "/api/command-center-projects?type=alerts", label: "Proactive alerts" },
    memory:      { url: "/api/command-center-memory",              label: "Remembered facts" },
    followups:   { url: "/api/command-center-followups",           label: "Follow-ups" },
    contractors: { url: "/api/command-center-contractors",         label: "Contractors" }
  };

  // External systems the Command Center will connect to in later phases.
  // These are descriptions of real systems that exist OUTSIDE this repo --
  // not data, and never shown as connected. Phase 1 has no link to any of
  // them, so every one renders as "Not connected".
  var INTEGRATIONS = [
    { id: "hermes",    name: "Mya runtime (Hermes VPS)", role: "Mya's production agent runtime — Telegram, routing, long-running work." },
    { id: "telegram",  name: "Telegram",                 role: "Mya's mobile messaging channel, served by the Hermes runtime." },
    { id: "hindsight", name: "Hindsight memory",         role: "Mya's long-term memory store — source for Memory / Constellation." },
    { id: "router",    name: "Local Qwen router",        role: "On-VPS model routing for everyday requests." },
    { id: "claude",    name: "Claude escalation",        role: "Escalation path for complex reasoning from the Hermes runtime." },
    { id: "mcp",       name: "Hermes MCP read bridge",   role: "Hermes → Command Center tools. Read-only allowlist (get_project, get_client, search_projects); status isn't observable from here yet." },
    { id: "windows",   name: "Windows bridge",           role: "Desktop control on your PC — screen, click, type, always with confirmation." },
    { id: "houzz",     name: "Houzz Pro",                role: "Construction operating system of record. Mya will orchestrate above it, not replace it." }
  ];

  var POLL_MS = 60 * 1000;
  var entries = {};
  var pollTimer = null;

  Object.keys(SOURCES).forEach(function (name) {
    entries[name] = { name: name, data: null, lastSuccessAt: 0, lastAttemptAt: 0, lastError: null, inFlight: false };
  });

  function notify(name) {
    MyaEvents.emit("data.changed", { source: name });
  }

  function fetchSource(name) {
    var src = SOURCES[name];
    var entry = entries[name];
    if (!src || !entry) return Promise.resolve(null);
    entry.inFlight = true;
    entry.lastAttemptAt = Date.now();
    notify(name);
    return fetch(src.url, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (res) {
        if (res.status === 401) {
          var err = new Error("unauthorized");
          err.unauthorized = true;
          throw err;
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (json) {
        entry.data = json;
        entry.lastSuccessAt = Date.now();
        entry.lastError = null;
        return json;
      })
      .catch(function (err) {
        entry.lastError = (err && err.message) || "failed";
        // Stamp the failure strictly after any earlier success so a refresh
        // that fails within the same millisecond still reads as "stale".
        entry.lastAttemptAt = Math.max(Date.now(), entry.lastSuccessAt + 1);
        if (err && err.unauthorized) MyaEvents.emit("auth.expired", { source: name });
        return null;
      })
      .then(function (result) {
        entry.inFlight = false;
        notify(name);
        return result;
      });
  }

  function refreshAll() {
    return Promise.all(Object.keys(SOURCES).map(fetchSource));
  }

  function freshness(name, now) {
    return MyaLib.computeFreshness(entries[name], now);
  }

  function allFreshness(now) {
    return Object.keys(SOURCES).map(function (name) { return freshness(name, now); });
  }

  function lastSyncAt() {
    return Object.keys(entries).reduce(function (max, k) { return Math.max(max, entries[k].lastSuccessAt); }, 0);
  }

  function schedule() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.visibilityState === "visible") refreshAll();
    }, POLL_MS);
  }

  function start() {
    schedule();
    // Coming back to a tab that sat in the background: refresh right away
    // rather than showing up-to-a-minute-old numbers as if they were current.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshAll();
    });
    return refreshAll();
  }

  function stop() { clearInterval(pollTimer); }

  // Mya's tool calls change data; refresh exactly what the tool could have
  // touched (same tool-name mapping the classic dashboard and Build 12 use).
  var TOOL_SOURCES = {
    add_contractor: ["contractors"], remove_contractor: ["contractors"],
    resolve_approval: ["approvals", "alerts"],
    create_followup: ["followups", "alerts"],
    remember_fact: ["memory"],
    create_project: ["projects", "data"], update_project: ["projects", "data"],
    create_appointment: ["data"],
    reclassify_caller: ["data"], backfill_caller_classifications: ["data"],
    add_estimate_item: ["data"], remove_estimate_item: ["data"]
  };

  function refreshForTools(toolsUsed) {
    if (!Array.isArray(toolsUsed) || toolsUsed.length === 0) return;
    if (toolsUsed.indexOf("undo_last_action") !== -1) { refreshAll(); return; }
    var wanted = {};
    toolsUsed.forEach(function (t) { (TOOL_SOURCES[t] || []).forEach(function (s) { wanted[s] = true; }); });
    // Anything that ran is recorded as a recent action in the snapshot.
    wanted.data = true;
    Object.keys(wanted).forEach(fetchSource);
  }

  global.MyaData = {
    SOURCES: SOURCES,
    INTEGRATIONS: INTEGRATIONS,
    get: function (name) { return entries[name]; },
    fetch: fetchSource,
    refreshAll: refreshAll,
    refreshForTools: refreshForTools,
    freshness: freshness,
    allFreshness: allFreshness,
    lastSyncAt: lastSyncAt,
    start: start,
    stop: stop
  };
})(window);
