/**
 * MyaPresence: the persistent "what is Mya doing?" layer.
 *
 * The one Mya Core already moves between slots (MyaShell). This layer adds
 * the words and signals that go with it, wherever you are:
 *   - the desktop rail dock: Core + state + one-line detail;
 *   - the status strip's Mya item;
 *   - html[data-presence], which colors the phone tab-bar Core's ring;
 *   - a toast when she starts, finishes or fails a request while you're
 *     away from the Mya view;
 *   - the Operations "Mya · this session" feed: what you asked, what she
 *     answered or failed, and availability changes, as they happened in
 *     this browser tab. It's kept in memory only and never presented as
 *     her full history (that lives in Hermes).
 *
 * Every input is a real signal (see MyaLib.derivePresence). Dev-preview Core
 * states (?dev=1) are ignored here, so review-only states never read as
 * real activity.
 */
(function (global) {
  "use strict";

  var s = { core: "idle", availability: "loading", lastOutcome: null, approvals: null, micOn: false, pendingText: "", capturing: false, transcript: "" };
  var lastReply = "";
  var seen = {};
  var feed = [];
  var FEED_MAX = 30;
  var lastAvailability = null;
  var inlineAsk = false;
  var shownKey = null, timedKey = null;
  var hideTimer = null, seenTimer = null;

  function $(id) { return document.getElementById(id); }
  function route() { return document.documentElement.getAttribute("data-route") || "home"; }

  function approvalsCount() {
    var f = MyaData.freshness("approvals");
    if (f.state !== "live" && f.state !== "stale") return null;
    var a = MyaData.get("approvals");
    return a && a.data && Array.isArray(a.data.approvals) ? a.data.approvals.length : null;
  }

  function render() {
    var p = MyaLib.derivePresence(s);
    document.documentElement.setAttribute("data-presence", p.state);
    var labels = document.querySelectorAll("[data-presence-label]");
    for (var i = 0; i < labels.length; i++) labels[i].textContent = p.label;
    var details = document.querySelectorAll("[data-presence-detail]");
    for (var j = 0; j < details.length; j++) details[j].textContent = p.detail;
    // Waiting on you? Every presence surface leads to what she's waiting on.
    var target = p.state === "approval" ? "#/approvals" : "#/mya";
    var links = document.querySelectorAll("#presence-dock, .strip-mya, #session-now");
    for (var k = 0; k < links.length; k++) links[k].setAttribute("href", target);
    var dock = $("presence-dock");
    if (dock) dock.setAttribute("aria-label", "Mya: " + p.label + ". " + p.detail + ". " + (p.state === "approval" ? "Open Approvals." : "Open Mya."));
    // The Core rests in its approval state only while approvals are really
    // pending, and dims to "blocked" only while Executive Mya is unreachable.
    MyaCore.setResting(p.state === "approval" ? "awaiting-approval" : p.state === "blocked" ? "blocked" : "idle");
    renderToast(p);
    renderFeed();
  }

  // Thinking shows for as long as she's working. A reply or a failure shows
  // once, briefly, then counts as seen, even though "Replied" stays on the
  // dock for a minute.
  function toastKey(p) {
    if (p.state === "thinking" || p.state === "waiting") return "thinking";
    if ((p.state === "completed" || p.state === "error") && s.lastOutcome) return p.state + ":" + s.lastOutcome.at;
    return null;
  }

  function renderToast(p) {
    var toast = $("presence-toast");
    if (!toast) return;
    var key = toastKey(p);
    // Asked from a module's "Ask Mya" bar: the answer shows right there. A
    // voice turn has its own capsule, so no toast on top of it.
    var voiceUp = Boolean(document.documentElement.getAttribute("data-voice"));
    if (route() === "mya" || !key || seen[key] || inlineAsk || voiceUp) { hideToast(); return; }
    toast.setAttribute("data-state", p.state);
    toast.querySelector("[data-toast-label]").textContent =
      p.state === "thinking" ? "Mya is thinking" : p.state === "waiting" ? "Mya is still working" : p.state === "completed" ? "Mya replied" : "Mya didn't answer";
    toast.querySelector("[data-toast-detail]").textContent =
      p.state === "completed" && lastReply ? MyaLib.snippet(lastReply, 120) : p.detail;
    clearTimeout(hideTimer);
    toast.hidden = false;
    requestAnimationFrame(function () { toast.classList.add("is-in"); });
    shownKey = key;
    if (key !== "thinking" && timedKey !== key) {
      timedKey = key;
      clearTimeout(seenTimer);
      seenTimer = setTimeout(function () { seen[key] = true; render(); }, p.state === "error" ? 9000 : 7000);
    }
  }

  function hideToast() {
    var toast = $("presence-toast");
    if (!toast || toast.hidden) return;
    toast.classList.remove("is-in");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { toast.hidden = true; }, 220);
  }

  function dismissToast() {
    if (shownKey && shownKey !== "thinking") seen[shownKey] = true;
    hideToast();
  }

  function logActivity(kind, title, detail) {
    feed.unshift({ kind: kind, title: title, detail: detail || "", at: Date.now() });
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    renderFeed();
  }

  function renderFeed() {
    var p = MyaLib.derivePresence(s);
    var now = $("session-now");
    if (now) {
      now.setAttribute("data-state", p.state);
      now.querySelector("[data-now-label]").textContent = p.label;
      now.querySelector("[data-now-detail]").textContent = p.detail;
    }
    var list = $("session-feed");
    if (!list) return;
    list.textContent = "";
    if (!feed.length) {
      var empty = document.createElement("li");
      empty.className = "feed-empty";
      empty.textContent = "Nothing yet in this session. Ask Mya something and it will show here as it happens.";
      list.appendChild(empty);
      return;
    }
    feed.forEach(function (e) {
      var li = document.createElement("li");
      li.className = "feed-item";
      li.setAttribute("data-kind", e.kind);
      var dot = document.createElement("span");
      dot.className = "feed-dot";
      dot.setAttribute("aria-hidden", "true");
      var body = document.createElement("div");
      body.className = "feed-body";
      var t = document.createElement("strong");
      t.textContent = e.title;
      body.appendChild(t);
      if (e.detail) {
        var d = document.createElement("span");
        d.textContent = e.detail;
        body.appendChild(d);
      }
      var time = document.createElement("time");
      time.className = "time";
      time.dateTime = new Date(e.at).toISOString();
      time.textContent = MyaLib.formatRelative(e.at);
      li.appendChild(dot); li.appendChild(body); li.appendChild(time);
      list.appendChild(li);
    });
  }

  function init() {
    MyaEvents.on("core.state", function (e) {
      if (!e || e.dev) return;
      s.core = e.state;
      render();
    });
    MyaEvents.on("chat.line", function (line) {
      if (line && line.role === "user") {
        s.pendingText = line.text;
        inlineAsk = Boolean(line.inline);
        logActivity("asked", line.voice ? "You said" : "You asked", MyaLib.snippet(line.text, 140));
      }
    });
    MyaEvents.on("mya.outcome", function (o) {
      s.lastOutcome = { ok: Boolean(o && o.ok), at: Date.now() };
      s.pendingText = "";
      if (o && o.ok) lastReply = o.reply || "";
      if (o && o.ok) logActivity("replied", "Mya replied", MyaLib.snippet(lastReply, 160));
      else logActivity("failed", "Mya didn't answer", "Nothing was sent to another assistant.");
      render();
    });
    MyaEvents.on("mya.availability", function (a) {
      s.availability = a.availability;
      // Log real changes only: never the first real answer, and never the
      // "loading"/"unknown" readings before Systems has answered at all.
      var reachable = a.availability === "connected" || a.availability === "configured";
      var was = lastAvailability;
      var settled = a.availability !== "loading" && !(a.availability === "unknown" && was === null);
      if (settled) {
        if (was !== null && was !== reachable) {
          logActivity(reachable ? "available" : "unavailable",
            reachable ? "Executive Mya is available" : "Executive Mya became unavailable",
            reachable ? "" : "Chat is off until she's reachable again.");
        }
        lastAvailability = reachable;
      }
      render();
    });
    MyaEvents.on("mic.changed", function (m) { s.micOn = Boolean(m.micEnabled && m.supported); render(); });
    MyaEvents.on("voice.capture", function (c) { s.capturing = Boolean(c.capturing); s.transcript = c.transcript || ""; render(); });
    MyaEvents.on("data.changed", function (d) {
      if (d && d.source === "approvals") { s.approvals = approvalsCount(); render(); }
    });
    window.addEventListener("hashchange", function () { render(); });
    var toast = $("presence-toast");
    if (toast) {
      toast.querySelector("[data-toast-close]").addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); dismissToast(); });
      toast.addEventListener("click", dismissToast);
    }
    // "Replied" and "Didn't answer" expire on their own, and feed times age;
    // re-derive periodically.
    setInterval(function () { render(); renderFeed(); }, 15000);
    s.approvals = approvalsCount();
    render();
  }

  global.MyaPresence = { init: init };
})(window);
