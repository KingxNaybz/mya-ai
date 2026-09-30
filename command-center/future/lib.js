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

  // Counts per status for the Systems overview. Anything with an unknown
  // status counts as not_observable, never as up.
  function countSystemStatuses(systems) {
    var counts = { up: 0, down: 0, configured: 0, not_configured: 0, not_observable: 0 };
    (systems || []).forEach(function (x) {
      var st = x && SYSTEM_LABELS[x.status] ? x.status : "not_observable";
      counts[st]++;
    });
    return counts;
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

  // Who asked for an audited action: the surface recorded in
  // mya_action_log.requested_by. An unknown surface is shown as-is, never
  // guessed.
  var SURFACE_LABELS = {
    hermes_mcp: "Hermes, via the MCP read bridge",
    dashboard_direct_ui: "You, in the Command Center",
    desktop_app: "Windows desktop app",
    dashboard_or_desktop_chat: "Command Center chat (before Executive Mya)"
  };
  function surfaceLabel(surface) {
    return SURFACE_LABELS[surface] || String(surface || "Unknown source").replace(/_/g, " ");
  }

  // Permission levels as getPermissionLevel() assigns them
  // (agent-os/standards/api/mya-skills-permissions.md): 0 read (by name
  // prefix), 2 write (the default for everything else), 3 needs approval.
  // Level 1 isn't assigned today.
  function permissionLabel(level) {
    return level === 0 ? "Read" : level === 1 || level === 2 ? "Write" : level >= 3 ? "Needs approval" : "Unrated";
  }

  function toolLabel(name) {
    if (TOOL_LABELS[name]) return TOOL_LABELS[name];
    var words = String(name || "tool").replace(/_/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /* ---------------- Mya presence ----------------
     One answer to "what is Mya doing right now?", derived ONLY from real
     signals: the Core's live state (a request in flight, a reply being
     spoken, the mic), the outcome of her last request, whether Executive Mya
     is reachable, and live/stale approvals. There's no "working in the
     background" state because nothing reports background work to the
     Command Center yet, so it is never shown.
       s.core          current Core state ("thinking", "speaking", ...)
       s.availability  "connected" | "configured" | "unavailable" | "unknown" | "loading"
       s.lastOutcome   { ok: bool, at: ms } | null
       s.approvals     number | null (null = not known, never treated as 0)
       s.micOn         bool
       s.pendingText   what the owner last asked, while a request is in flight
       s.capturing     bool: a tap-to-talk turn is recording right now
       s.transcript    what she has heard so far in that turn (live)
     "waiting" is real too: the Core moves to it once a request has been in
     flight for WAITING_AFTER_MS with no answer yet (see chat.js).
     Returns { state, label, detail }. */
  var COMPLETED_HOLD_MS = 60 * 1000;
  var FAILED_HOLD_MS = 5 * 60 * 1000;

  function snippet(text, max) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }

  function derivePresence(s, now) {
    s = s || {};
    now = now == null ? Date.now() : now;
    var out = s.lastOutcome;
    var age = out ? now - out.at : Infinity;
    if (s.core === "thinking") {
      return { state: "thinking", label: "Thinking", detail: s.pendingText ? "On: “" + snippet(s.pendingText, 60) + "”" : "Working on your request" };
    }
    if (s.core === "waiting") {
      return { state: "waiting", label: "Still working", detail: "Waiting on her runtime" + (s.pendingText ? " · “" + snippet(s.pendingText, 40) + "”" : "") };
    }
    if (s.core === "speaking") return { state: "speaking", label: "Speaking", detail: "Replying now · tap to stop" };
    if (s.capturing) {
      return { state: "listening", label: "Listening", detail: s.transcript ? "“" + snippet(s.transcript, 60) + "”" : "Go ahead, I'm listening" };
    }
    if (out && !out.ok && age < FAILED_HOLD_MS) {
      return { state: "error", label: "Didn't answer", detail: "Her last reply failed. Nothing was sent elsewhere." };
    }
    if (out && out.ok && age < COMPLETED_HOLD_MS) return { state: "completed", label: "Replied", detail: "Just now" };
    if (s.availability === "unavailable") {
      return { state: "blocked", label: "Unavailable", detail: "Executive Mya isn't configured here" };
    }
    if (s.availability === "unknown") return { state: "blocked", label: "Not connected", detail: "Can't check her runtime right now" };
    if (s.micOn) return { state: "listening", label: "Listening", detail: "Say “Mya” to talk" };
    if (typeof s.approvals === "number" && s.approvals > 0) {
      return { state: "approval", label: "Waiting on you", detail: s.approvals + (s.approvals === 1 ? " approval needs" : " approvals need") + " your decision" };
    }
    if (s.availability === "loading") return { state: "idle", label: "Ready", detail: "Checking her runtime…" };
    return {
      state: "idle",
      label: "Ready",
      detail: s.availability === "connected" ? "Connected · ask anything" : "Configured · her first reply confirms it"
    };
  }

  /* ---------------- Voice capsule ----------------
     What the floating voice capsule says for one voice turn (or for any
     reply she's speaking). Pure, so every phase and failure is testable.
       v.phase       "listening" | "thinking" | "waiting" | "working" |
                     "speaking" | "completed" | "error" | anything else = hidden
       v.transcript  what she heard (live while listening)
       v.reply       her reply text, once it arrives
       v.error       a VOICE_ERRORS key
       v.startedAt   when the request was sent (ms), for the waiting timer
       v.muted       her voice is off, so the reply was text only
       v.noAudio     voice was on but no audio came back
       v.dev         a dev simulation, never real
     Returns { visible, phase, label, detail, action, tone }. action is the
     primary button: "send" (finish listening now), "stop" (stop speaking),
     or null. */
  var WAITING_AFTER_MS = 8000;
  var VOICE_ERRORS = {
    "unsupported": { label: "Voice input isn't available", detail: "This browser can't transcribe speech. Try Chrome or Edge, or type instead." },
    "mic-denied": { label: "Microphone blocked", detail: "Allow microphone access for this site in the address bar, then tap to talk again." },
    "no-mic": { label: "No microphone found", detail: "Check that a microphone is connected, then try again." },
    "speech-network": { label: "Speech service unreachable", detail: "The browser couldn't reach its speech recognition service. Check your connection." },
    "no-speech": { label: "I didn't catch that", detail: "Nothing was heard, so nothing was sent. Tap to talk and try again." },
    "unavailable": { label: "Executive Mya is unavailable", detail: "Voice goes only to Executive Mya, and she can't be reached right now. Nothing was sent." },
    "failed": { label: "Executive Mya didn't answer", detail: "Nothing was sent to another assistant. Try again in a moment." },
    "busy": { label: "One moment", detail: "She's still answering your last request." }
  };

  function voiceCapsule(v, now) {
    v = v || {};
    now = now == null ? Date.now() : now;
    var heard = v.transcript ? "“" + snippet(v.transcript, 90) + "”" : "";
    var out = { visible: true, phase: v.phase, label: "", detail: "", action: null, tone: v.phase };
    switch (v.phase) {
      case "listening":
        out.label = "Listening";
        out.detail = heard || "Go ahead, I'm listening…";
        out.action = "send";
        break;
      case "thinking":
        out.label = "Thinking";
        out.detail = heard || "Working on your request";
        break;
      case "waiting":
        out.label = "Still working";
        var secs = v.startedAt ? Math.max(0, Math.round((now - v.startedAt) / 1000)) : 0;
        out.detail = "Waiting on Executive Mya" + (secs ? " · " + secs + "s" : "");
        break;
      case "working":
        out.label = "Working";
        out.detail = "Using her tools";
        break;
      case "speaking":
        out.label = "Speaking";
        out.detail = v.reply ? snippet(v.reply, 110) : "Replying now";
        out.action = "stop";
        break;
      case "completed":
        out.label = "Done";
        out.detail = v.muted ? "Her voice is muted, so the reply is in the conversation."
          : v.noAudio ? "Her voice reply didn't come through. The text is in the conversation."
          : v.reply ? snippet(v.reply, 110) : "Replied";
        break;
      case "error":
        var e = VOICE_ERRORS[v.error] || VOICE_ERRORS.failed;
        out.label = e.label;
        out.detail = e.detail;
        break;
      default:
        return { visible: false, phase: null, label: "", detail: "", action: null, tone: null };
    }
    return out;
  }

  /* ---------------- "Ask Mya about this" context ----------------
     A short, plain-text note of what the owner is looking at, sent to
     Executive Mya along with the question so she knows which screen it's
     about. Only data that actually loaded is included: stale data is
     labeled stale, and a source that never loaded is described as not
     connected. It's never guessed or filled in. Capped so a big list
     can't swamp the question.
       src[name] = { state: "live"|"stale"|"offline"|"loading", data } */
  var CONTEXT_VIEWS = {
    projects: "Projects", approvals: "Approvals", memory: "Memory", files: "Files",
    operations: "Operations", devices: "Devices", systems: "Systems"
  };
  var CONTEXT_MAX_ITEMS = 8;

  function sourceNote(entry, what) {
    if (!entry || (entry.state !== "live" && entry.state !== "stale")) return what + ": not connected on this screen right now.";
    return null;
  }

  function buildScreenContext(view, src) {
    src = src || {};
    var title = CONTEXT_VIEWS[view] || "Command Center";
    var lines = ["The owner is looking at the Command Center " + title + " screen."];
    var stale = function (e) { return e && e.state === "stale" ? " (last known, may be stale)" : ""; };

    if (view === "projects") {
      var d = src.projectDetail;
      var p = d && d.data && d.data.project;
      if (p && (d.state === "live" || d.state === "stale")) {
        lines.push("Open project" + stale(d) + ": " + p.project_name + (p.client_name ? " for " + p.client_name : "") +
          (p.status ? ", status " + p.status : "") + (p.next_action ? ", next action: " + p.next_action : "") + ".");
      }
      var pe = src.projects;
      var note = sourceNote(pe, "Project list");
      if (note) lines.push(note);
      else {
        var list = (pe.data && pe.data.projects) || [];
        lines.push(list.length ? "Active projects on screen" + stale(pe) + ":" : "No active projects on screen" + stale(pe) + ".");
        list.slice(0, CONTEXT_MAX_ITEMS).forEach(function (x) {
          lines.push("- " + x.project_name + (x.status ? " (" + x.status + ")" : "") + (x.next_action ? ": next " + x.next_action : ""));
        });
        if (list.length > CONTEXT_MAX_ITEMS) lines.push("- …and " + (list.length - CONTEXT_MAX_ITEMS) + " more");
      }
    } else if (view === "approvals") {
      var ae = src.approvals;
      var an = sourceNote(ae, "Pending approvals");
      if (an) lines.push(an);
      else {
        var al = (ae.data && ae.data.approvals) || [];
        lines.push(al.length ? al.length + " pending approval(s) on screen" + stale(ae) + ":" : "No pending approvals on screen" + stale(ae) + ".");
        al.slice(0, CONTEXT_MAX_ITEMS).forEach(function (x) { lines.push("- " + x.title + (x.detail ? ": " + x.detail : "")); });
      }
    } else if (view === "systems") {
      var se = src.systems;
      var sn = sourceNote(se, "System health");
      if (sn) lines.push(sn);
      else {
        lines.push("System status on screen" + stale(se) + ":");
        ((se.data && se.data.systems) || []).slice(0, 12).forEach(function (x) { lines.push("- " + x.name + ": " + String(x.status).replace(/_/g, " ")); });
      }
    }
    return { label: title, text: lines.join("\n") };
  }

  // Which runtime chat should use. Hermes has no health endpoint, so a
  // Systems report can only say whether the Hermes bridge key is set
  // ("not_observable" or, in theory, "up"). That's enough to route chat to
  // Executive Mya. Whether she is actually reachable is shown by her replies,
  // never assumed. Missing or failed Systems data counts as unknown.
  function executiveMyaRoute(system, sourceFreshness) {
    var f = sourceFreshness || { state: "offline" };
    if (f.state === "loading") return "loading";
    if (f.state !== "live" && f.state !== "stale") return "unknown";
    var st = system && system.status;
    if (st === "up" || st === "not_observable") return "hermes";
    if (st === "not_configured") return "not_configured";
    return "unknown";
  }

  return {
    integrationStatus: integrationStatus,
    systemsDown: systemsDown,
    countSystemStatuses: countSystemStatuses,
    toolLabel: toolLabel,
    surfaceLabel: surfaceLabel,
    permissionLabel: permissionLabel,
    executiveMyaRoute: executiveMyaRoute,
    derivePresence: derivePresence,
    voiceCapsule: voiceCapsule,
    VOICE_ERRORS: VOICE_ERRORS,
    WAITING_AFTER_MS: WAITING_AFTER_MS,
    buildScreenContext: buildScreenContext,
    snippet: snippet,
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
