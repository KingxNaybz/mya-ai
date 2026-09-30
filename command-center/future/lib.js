/**
 * MyaLib — pure, DOM-free helpers for the Command Center shell.
 *
 * Kept free of DOM/network access so the rules that decide what the owner
 * sees (is this number Live, Stale, or Not connected? what does the
 * briefing actually claim?) can be unit-tested in Node (tests/command-center/).
 * Loaded in the browser as window.MyaLib; required in Node via module.exports.
 */
(function (root, factory) {
  var lib = factory();
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.MyaLib = lib;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  // Every piece of text that came from a phone call, a chat, or the
  // database goes through this before it is placed into markup.
  function escapeHtml(text) {
    return (text == null ? "" : String(text)).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  function formatRelative(iso, now) {
    if (!iso) return "";
    var t = typeof iso === "number" ? iso : new Date(iso).getTime();
    if (!isFinite(t)) return "";
    var diffMs = (now == null ? Date.now() : now) - t;
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hr" + (hrs === 1 ? "" : "s") + " ago";
    var days = Math.round(hrs / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function formatAge(ms) {
    if (ms < 60000) return "now";
    var mins = Math.floor(ms / 60000);
    if (mins < 60) return mins + "m";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h";
    return Math.floor(hrs / 24) + "d";
  }

  /* ---------------- Freshness ----------------
     The single rule for every data block in the Command Center:
       live          last fetch succeeded and is younger than staleAfterMs
       stale         we have data, but it's older than that OR the latest
                     refresh failed (the data on screen is last-known, not current)
       offline       never successfully loaded, or there's no integration
                     behind it at all ("Not connected")
       loading       first fetch still in flight
     Nothing is ever shown as live without a successful fetch behind it. */
  var DEFAULT_STALE_AFTER_MS = 3 * 60 * 1000;

  function computeFreshness(entry, now, staleAfterMs) {
    now = now == null ? Date.now() : now;
    staleAfterMs = staleAfterMs || DEFAULT_STALE_AFTER_MS;
    if (!entry || entry.notConnected) return { state: "offline", age: null };
    var last = entry.lastSuccessAt || 0;
    if (!last) return { state: entry.inFlight ? "loading" : "offline", age: null };
    var age = Math.max(0, now - last);
    var refreshFailed = Boolean(entry.lastError) && (entry.lastAttemptAt || 0) > last;
    if (refreshFailed || age > staleAfterMs) return { state: "stale", age: age };
    return { state: "live", age: age };
  }

  function freshnessLabel(f) {
    if (!f) return "Not connected";
    if (f.state === "live") return "Live";
    if (f.state === "stale") return "Stale · " + formatAge(f.age || 0);
    if (f.state === "loading") return "Loading";
    return "Not connected";
  }

  // Worst-of for the status strip: one glance tells you whether anything
  // on screen is not current. unauthorized > offline > stale > loading > live.
  var SEVERITY = { live: 0, loading: 1, stale: 2, offline: 3 };
  function worstFreshness(list) {
    var worst = null;
    (list || []).forEach(function (f) {
      if (!f) return;
      if (!worst || SEVERITY[f.state] > SEVERITY[worst.state]) worst = f;
    });
    return worst || { state: "offline", age: null };
  }

  /* ---------------- Executive briefing ----------------
     Built ONLY from values that actually arrived. A null/undefined value
     means "we don't know", and is left out rather than guessed or zeroed.
     Returns { text, known } -- known=false means we had nothing real to say. */
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function buildBriefing(s) {
    s = s || {};
    var parts = [];
    if (typeof s.approvals === "number") {
      // approvalsAtLeast: the source caps its list, so a full page means
      // "this many or more" -- never state a possibly-low number as exact.
      var approvalsText = s.approvalsAtLeast ? "at least " + s.approvals + " items" : plural(s.approvals, "item", "items");
      parts.push(s.approvals === 0 ? "nothing waiting on your approval" : approvalsText + " waiting on your approval");
    }
    if (typeof s.alerts === "number" && s.alerts > 0) parts.push(plural(s.alerts, "alert", "alerts") + " to look at");
    if (typeof s.followUps === "number") parts.push(plural(s.followUps, "open follow-up", "open follow-ups"));
    if (typeof s.newLeads === "number") parts.push(plural(s.newLeads, "new lead", "new leads"));
    if (typeof s.callsToday === "number") parts.push(plural(s.callsToday, "call", "calls") + " today");
    if (typeof s.scheduleToday === "number") {
      parts.push(s.scheduleToday === 0 ? "a clear schedule" : plural(s.scheduleToday, "item", "items") + " on today's schedule");
    }
    // systemsDown: names of systems a live check just found down. Only ever
    // passed from a successful Systems fetch -- unknown is never "down".
    var down = Array.isArray(s.systemsDown) && s.systemsDown.length
      ? " Heads up: " + joinAnd(s.systemsDown) + (s.systemsDown.length === 1 ? " is" : " are") + " down."
      : "";
    if (parts.length === 0) {
      return { known: false, text: "I can't reach your business data right now, so I won't guess. Check Systems for what's connected." + down };
    }
    return { known: true, text: "You have " + joinAnd(parts) + "." + down };
  }

  function joinAnd(list) {
    return list.length === 1 ? list[0] : list.slice(0, -1).join(", ") + ", and " + list[list.length - 1];
  }

  function partOfDay(hour) {
    if (hour < 12) return "morning";
    if (hour < 18) return "afternoon";
    return "evening";
  }

  /* ---------------- Routing ---------------- */
  function parseRoute(hash, validRoutes, fallback) {
    var id = String(hash || "").replace(/^#\/?/, "").split(/[/?]/)[0].toLowerCase();
    return validRoutes.indexOf(id) !== -1 ? id : (fallback || validRoutes[0]);
  }

  /* ---------------- Caller categories (Company Contacts) ---------------- */
  function categoryCounts(rows) {
    var counts = {};
    (rows || []).forEach(function (r) {
      var c = (r && r.category) || "uncategorized";
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.keys(counts)
      .map(function (k) { return { category: k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || (a.category < b.category ? -1 : 1); });
  }

  /* ---------------- Constellation layout ----------------
     Deterministic golden-angle spiral: the same N items always land in the
     same places (no jitter between refreshes), newest nearest the center.
     Returns points in a [0..width] x [0..height] box. */
  function layoutConstellation(n, width, height) {
    var pts = [];
    var cx = width / 2, cy = height / 2;
    var maxR = Math.min(width, height) / 2 - 14;
    var golden = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var r = maxR * Math.sqrt((i + 0.6) / Math.max(n, 1));
      var a = i * golden;
      pts.push({ x: +(cx + Math.cos(a) * r).toFixed(1), y: +(cy + Math.sin(a) * r * 0.82).toFixed(1) });
    }
    return pts;
  }

  /* ---------------- System health (Systems module) ----------------
     A system's status is only as good as the Systems fetch that reported
     it: if that fetch never succeeded (or is still loading) nothing is
     claimed, and if it's stale the last-known status is shown as stale --
     never as "Connected". `cls` is the .fresh variant used for the pill. */
  var SYSTEM_LABELS = {
    up: "Connected", down: "Down", configured: "Configured",
    not_configured: "Not configured", not_observable: "Not observable"
  };
  var STALE_LABELS = {
    up: "Was reachable · Stale", down: "Was down · Stale", configured: "Configured · Stale",
    not_configured: "Not configured · Stale", not_observable: "Not observable · Stale"
  };
  var SYSTEM_CLASSES = { up: "live", down: "down", configured: "configured", not_configured: "offline", not_observable: "offline" };

  function integrationStatus(system, sourceFreshness) {
    var f = sourceFreshness || { state: "offline" };
    if (f.state === "loading") return { state: "loading", label: "Checking", cls: "loading" };
    if (f.state !== "live" && f.state !== "stale") return { state: "offline", label: "Not connected", cls: "offline" };
    var st = system && SYSTEM_LABELS[system.status] ? system.status : "not_observable";
    if (f.state === "stale") {
      return { state: "stale", label: STALE_LABELS[st], cls: "stale" };
    }
    return { state: st, label: SYSTEM_LABELS[st], cls: SYSTEM_CLASSES[st] };
  }

  // Names of systems a LIVE Systems check found down. Stale or missing
  // data yields [] -- we don't announce outages we can't currently see.
  function systemsDown(systems, sourceFreshness) {
    if (!sourceFreshness || sourceFreshness.state !== "live" || !Array.isArray(systems)) return [];
    return systems.filter(function (x) { return x && x.status === "down"; }).map(function (x) { return x.name; });
  }

  /* ---------------- Chat metadata ---------------- */
  var TOOL_LABELS = {
    get_project: "Looked up a project", list_projects: "Listed projects", get_client: "Looked up a client",
    create_project: "Created a project", update_project: "Updated a project",
    recall_memory: "Checked remembered facts", remember_fact: "Remembered a fact",
    recall_hindsight: "Searched Hindsight memory",
    list_pending_approvals: "Checked approvals", resolve_approval: "Resolved an approval",
    get_dashboard_summary: "Checked the business snapshot", list_leads: "Checked leads",
    list_recent_activity: "Checked recent activity", list_schedule: "Checked the schedule",
    create_appointment: "Scheduled an appointment", create_followup: "Created a follow-up",
    get_company_brain: "Read the Company Brain", update_company_brain: "Updated the Company Brain",
    undo_last_action: "Undid the last action", list_capabilities: "Listed capabilities",
    get_services_status: "Checked services", calculate_estimate: "Calculated an estimate",
    evaluate_bid_price: "Evaluated a bid price"
  };

  function toolLabel(name) {
    if (TOOL_LABELS[name]) return TOOL_LABELS[name];
    var words = String(name || "tool").replace(/_/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function providerLabel(provider) {
    return provider === "hermes"
      ? "Answered by the Hermes runtime (text only, no Command Center tools)"
      : "Answered by Claude with Command Center tools";
  }

  return {
    integrationStatus: integrationStatus,
    systemsDown: systemsDown,
    toolLabel: toolLabel,
    providerLabel: providerLabel,
    escapeHtml: escapeHtml,
    formatRelative: formatRelative,
    formatAge: formatAge,
    computeFreshness: computeFreshness,
    freshnessLabel: freshnessLabel,
    worstFreshness: worstFreshness,
    buildBriefing: buildBriefing,
    partOfDay: partOfDay,
    parseRoute: parseRoute,
    categoryCounts: categoryCounts,
    layoutConstellation: layoutConstellation,
    DEFAULT_STALE_AFTER_MS: DEFAULT_STALE_AFTER_MS
  };
});
