/**
 * MyaWatch — Watch Mya: Mya working on your computer, live.
 *
 * Reads the "computer" and "computerFrame" sources (GET
 * /api/command-center-data?type=computer / computer-frame; contract in
 * lib/computer.ts) and sends the owner's control actions (POST
 * ?type=computer-control). The Windows Agent is never contacted directly:
 * it reports to the same API over its own outbound connection, and every
 * report's answer tells it whether it may issue input.
 *
 * Control ownership is always on screen (MyaLib.computerView):
 *   Mya control   she may issue input; you're watching
 *   Your control  you have the computer; she issues none
 *   Paused        her task is kept; she issues none
 *   Not connected no heartbeat -- nothing claimed
 *
 * Pace: the session is polled every 2s while you're on this view or a task
 * is running, every 20s otherwise, and not at all while the tab is hidden.
 * Frames (~1/s) are fetched only while this view is open and the agent is
 * live.
 *
 * Voice and text: anything you say or type goes to Executive Mya as usual
 * (chat.js), with this screen's context. While a task runs, a few words
 * also act immediately, and only toward less control for her
 * (MyaLib.watchVoiceIntent): "stop" / "wait" / "don't submit" pause her,
 * "I'll take over" takes control. Handing control back is always a button.
 *
 * Emits "computer.changed" (the view model) for presence and the Core.
 */
(function (global) {
  "use strict";

  var FAST_MS = 2000, SLOW_MS = 20000, FRAME_MS = 1000;
  var view = { state: "loading" };
  var pollTimer = null, frameTimer = null;
  var pending = null;          // control action in flight
  var lastStatus = null;
  var lastError = "";

  function $(id) { return document.getElementById(id); }
  function h(s) { return MyaLib.escapeHtml(s == null ? "" : String(s)); }
  function route() { return document.documentElement.getAttribute("data-route") || "home"; }
  function watching() { return route() === "watch"; }

  /* ---------------- Polling ---------------- */
  function schedule() {
    clearTimeout(pollTimer);
    if (document.visibilityState !== "visible") return;
    pollTimer = setTimeout(function () {
      MyaData.fetch("computer").then(schedule);
    }, watching() || view.active ? FAST_MS : SLOW_MS);
    clearTimeout(frameTimer);
    if (watching() && view.state === "ok" && view.connection !== "offline") {
      frameTimer = setTimeout(function () { MyaData.fetch("computerFrame"); }, FRAME_MS);
    }
  }

  function refreshNow() {
    MyaData.fetch("computer").then(function () {
      if (watching()) MyaData.fetch("computerFrame");
      schedule();
    });
  }

  /* ---------------- Control ---------------- */
  var ACTION_TEXT = {
    pause: "Pausing Mya…", resume: "Resuming…", take: "Taking control…", "return": "Handing control back…", stop: "Stopping the task…"
  };

  function control(action, source) {
    if (pending) return Promise.resolve(false);
    pending = action;
    lastError = "";
    render();
    return fetch("/api/command-center-data?type=computer-control", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: action })
    }).then(function (res) {
      if (res.status === 401) { MyaEvents.emit("auth.expired", { source: "computer-control" }); return false; }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { lastError = data.error || "That didn't go through. Nothing changed."; return false; }
        MyaEvents.emit("computer.control", { action: action, source: source || "button" });
        return true;
      });
    }).catch(function () {
      lastError = "Couldn't reach the Command Center. Nothing changed.";
      return false;
    }).then(function (ok) {
      pending = null;
      refreshNow();
      return ok;
    });
  }

  /* ---------------- Render ---------------- */
  function render() {
    var now = Date.now();
    view = MyaLib.computerView(MyaData.get("computer"), now);
    MyaEvents.emit("computer.changed", view);
    renderChrome();
    // Completed: a brief real "done" on the Core.
    var st = view.state === "ok" ? view.session.status : null;
    if (st === "completed" && lastStatus && lastStatus !== "completed" && MyaCore.getState() === MyaCore.restingState()) {
      MyaCore.setTemporary("completed", 2600);
    }
    lastStatus = st;
    if (!$("watch-banner")) return;
    renderBanner(now);
    renderViewport(now);
    renderControls();
    renderTask(now);
    renderTimeline();
    renderApproval();
    var fresh = $("watch-fresh");
    if (fresh) fresh.innerHTML = view.state === "loading" ? "" : '<span class="fresh ' + (view.state === "ok" ? (view.stale ? "stale" : "live") : "offline") +
      '"><span class="fresh-dot"></span>' + h(view.state === "ok" ? (view.stale ? "Stale" : "Live") : "Not connected") + "</span>";
  }

  // Rail pill, Home button, Devices line. (The strip's presence item and
  // the rail dock already lead here while she works: see presence.js.)
  function renderChrome() {
    var live = view.state === "ok" && view.active && view.connection !== "offline";
    var pills = document.querySelectorAll("[data-watch-live], [data-watch-cta]");
    for (var i = 0; i < pills.length; i++) pills[i].hidden = !live;
    var dev = $("devices-watch-fresh");
    if (dev) dev.innerHTML = '<span class="fresh ' + (view.state === "ok" ? (view.connection === "live" ? "live" : view.connection === "stale" ? "stale" : "offline") : "offline") +
      '"><span class="fresh-dot"></span>' + h(view.state === "ok" ? view.control.label : view.state === "not_configured" ? "Not set up" : "Not connected") + "</span>";
  }

  function connText(now) {
    var s = view.session;
    var age = s.heartbeatAt ? MyaLib.formatAge(now - Date.parse(s.heartbeatAt)) : "";
    var dev = s.deviceName ? s.deviceName + " · " : "";
    if (view.connection === "live") return dev + "Live · heartbeat " + age + " ago";
    if (view.connection === "stale") return dev + "Heartbeat stopped " + age + " ago";
    return dev + (s.heartbeatAt ? "Offline · last heartbeat " + age + " ago" : "Never reported");
  }

  function renderBanner(now) {
    var b = $("watch-banner");
    var label, detail, cls, conn = "";
    if (view.state === "ok") {
      cls = view.control.cls; label = view.control.label; detail = view.control.detail; conn = connText(now);
      if (pending) detail = ACTION_TEXT[pending];
    } else if (view.state === "not_configured") {
      cls = "offline"; label = "Not set up"; detail = "Watch Mya's storage isn't set up on the server yet, so there's no computer session to show.";
    } else if (view.state === "loading") {
      cls = "offline"; label = "Checking…"; detail = "";
    } else {
      cls = "offline"; label = "Not connected"; detail = "Can't reach Mya's computer session right now. Nothing is claimed.";
    }
    b.setAttribute("data-control", cls);
    b.querySelector("[data-cb-label]").textContent = label;
    b.querySelector("[data-cb-detail]").textContent = lastError || detail;
    b.classList.toggle("has-error", Boolean(lastError));
    b.querySelector("[data-cb-conn]").textContent = conn;
  }

  function renderViewport(now) {
    var vp = $("watch-viewport");
    var img = $("watch-frame");
    var empty = $("watch-empty");
    var ageEl = $("watch-frame-age");
    vp.setAttribute("data-conn", view.state === "ok" ? view.connection : "offline");
    vp.setAttribute("data-control", view.state === "ok" ? view.session.control : "");
    var appEl = $("watch-app");
    appEl.textContent = view.state === "ok" ? (view.session.step || view.session.app || "") : "";
    var fe = MyaData.get("computerFrame");
    var src = fe && fe.data ? MyaLib.safeFrameSrc(fe.data.frame) : null;
    var frameAt = fe && fe.data && fe.data.frameAt ? Date.parse(fe.data.frameAt) : NaN;
    // Show a frame only while it's recent and the agent is reporting; an
    // old picture is never passed off as live.
    var usable = src && view.state === "ok" && view.connection !== "offline" && isFinite(frameAt) && now - frameAt < 30000;
    if (usable) {
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      img.hidden = false;
      empty.hidden = true;
      ageEl.hidden = false;
      var age = now - frameAt;
      ageEl.textContent = age < 4000 ? "Live view" : "Frame " + MyaLib.formatAge(age) + " old";
      ageEl.classList.toggle("is-old", age >= 4000);
    } else {
      img.hidden = true;
      img.removeAttribute("src");
      ageEl.hidden = true;
      empty.hidden = false;
      empty.querySelector("[data-empty-text]").textContent =
        view.state === "not_configured" ? "Watch Mya isn't set up on the server yet. Nothing to show."
        : view.state !== "ok" ? "Can't reach Mya's computer session."
        : view.connection === "offline" ? "The Windows Agent isn't reporting, so there's no live view. Nothing is shown rather than an old picture."
        : "Waiting for the first frame from " + (view.session.deviceName || "the Windows Agent") + "…";
    }
  }

  // Two slots share places: Pause/Resume and Take control/Return control.
  // Stop is always shown, enabled only while there's a task to stop.
  function renderControls() {
    var c = view.state === "ok" ? MyaLib.computerControls(view) : { pause: false, resume: false, take: false, "return": false, stop: false };
    var shown = { pause: !c.resume, resume: c.resume, take: !c["return"], "return": c["return"], stop: true };
    var btns = document.querySelectorAll("[data-computer]");
    for (var i = 0; i < btns.length; i++) {
      var a = btns[i].getAttribute("data-computer");
      btns[i].hidden = !shown[a];
      btns[i].disabled = !c[a] || Boolean(pending);
      btns[i].classList.toggle("is-pending", pending === a);
    }
  }

  function renderTask(now) {
    var dl = $("watch-task");
    var tag = $("watch-status");
    if (view.state !== "ok") {
      dl.innerHTML = "<dt>Task</dt><dd class=\"muted\">—</dd>";
      tag.hidden = true;
      return;
    }
    var s = view.session;
    var rows = [
      ["Task", s.task || "No task right now"],
      ["Application", s.app || "—"],
      ["Current step", s.step || "—"],
      ["Elapsed", view.elapsedMs != null ? MyaLib.formatElapsed(view.elapsedMs) : "—"],
      ["Computer", (s.deviceName || "Windows Agent") + " · " + (view.connection === "live" ? "connected" : view.connection === "stale" ? "heartbeat stopped" : "offline")]
    ];
    dl.innerHTML = rows.map(function (r) { return "<dt>" + h(r[0]) + "</dt><dd>" + h(r[1]) + "</dd>"; }).join("");
    var LABELS = { idle: "Idle", working: "Working", waiting: "Waiting", approval: "Approval needed", completed: "Completed", blocked: "Blocked", stopped: "Stopped" };
    tag.hidden = false;
    tag.textContent = LABELS[s.status] || s.status;
    tag.setAttribute("data-status", s.status);
  }

  function renderTimeline() {
    var ol = $("watch-timeline");
    if (view.state !== "ok" || !view.events.length) {
      ol.innerHTML = '<li class="feed-empty">' + (view.state === "ok" ? "No activity reported yet." : "Not connected.") + "</li>";
      return;
    }
    ol.innerHTML = view.events.slice(0, 30).map(function (e) {
      var t = Date.parse(e.at);
      return '<li data-kind="' + h(e.kind) + '" data-by="' + h(e.by) + '"><span class="tl-dot" aria-hidden="true"></span><div><p>' + h(e.text) + "</p>" +
        (e.app ? '<span class="muted small">' + h(e.app) + "</span>" : "") + "</div>" +
        (isFinite(t) ? '<time datetime="' + h(e.at) + '">' + h(MyaLib.formatRelative(t)) + "</time>" : "") + "</li>";
    }).join("");
  }

  function renderApproval() {
    var card = $("watch-approval");
    var s = view.state === "ok" ? view.session : null;
    if (!s || s.status !== "approval") { card.hidden = true; return; }
    card.hidden = false;
    var ap = MyaData.get("approvals");
    var list = ap && ap.data && Array.isArray(ap.data.approvals) ? ap.data.approvals : [];
    var match = list.filter(function (a) { return s.approvalId && String(a.id) === String(s.approvalId); })[0];
    $("watch-approval-text").textContent = match
      ? (match.title + (match.detail ? " — " + match.detail : "")).replace(/[.\s]+$/, "") + ". She won't go past this step until you decide."
      : (s.step || "She's waiting on a decision") + ". She won't go past this step until you decide in Approvals.";
  }

  /* ---------------- Words that act at once ---------------- */
  var INTENT_TEXT = { pause: "Paused her the moment you said it.", take: "You have control. She stopped issuing input." };
  function onUserLine(line) {
    if (!line || line.role !== "user" || view.state !== "ok" || !view.active) return;
    var intent = MyaLib.watchVoiceIntent(line.text);
    if (!intent) return;
    var c = MyaLib.computerControls(view);
    if (!c[intent]) return;
    control(intent, line.voice ? "voice" : "text").then(function (ok) {
      if (ok && global.MyaViews) MyaViews.toast(INTENT_TEXT[intent]);
    });
  }

  function init() {
    var controls = $("watch-controls");
    if (controls) controls.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-computer]");
      if (b && !b.disabled) control(b.getAttribute("data-computer"), "button");
    });
    MyaEvents.on("data.changed", function (d) {
      if (d && (d.source === "computer" || d.source === "computerFrame" || d.source === "approvals")) render();
    });
    MyaEvents.on("chat.line", onUserLine);
    window.addEventListener("hashchange", function () { setTimeout(refreshNow, 0); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshNow(); else { clearTimeout(pollTimer); clearTimeout(frameTimer); }
    });
    // Ages tick without new data (Live -> heartbeat stopped).
    setInterval(render, 1000);
    render();
    refreshNow();
  }

  global.MyaWatch = { init: init, control: control, view: function () { return view; } };
})(window);
