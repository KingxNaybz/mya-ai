/**
 * MyaViews — renders every Command Center module from MyaData.
 *
 * Rules every renderer follows:
 *   - All text from the database / calls / chat goes through MyaLib.escapeHtml.
 *   - A block whose source never loaded says "Not connected" -- it never
 *     shows zeros, placeholders, or sample content in its place.
 *   - A block whose latest refresh failed keeps its last-known data but is
 *     tagged Stale (see MyaLib.computeFreshness).
 *   - Systems that don't exist in the Command Center yet are rendered as
 *     explicit "Not connected" integration cards, never as dead controls.
 */
(function (global) {
  "use strict";

  var h = MyaLib.escapeHtml;
  var APPROVALS_PAGE_LIMIT = 10; // command-center-approvals.ts returns at most 10 pending
  var PROJECTS_PAGE_LIMIT = 6;   // command-center-projects.ts returns at most 6 active

  var CALLER_CATEGORY_LABELS = {
    lead: "Leads", existing_client: "Existing clients", vendor: "Vendors", contractor: "Contractors",
    subcontractor: "Subcontractors", general_contractor: "General contractors", bill_collector: "Bill collectors",
    job_applicant: "Job applicants", wrong_number_or_spam: "Wrong number / spam", uncategorized: "Uncategorized"
  };

  /* ---------------- small helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function fresh(name) { return MyaData.freshness(name); }
  function has(name) { var f = fresh(name); return f.state === "live" || f.state === "stale"; }
  function payload(name) { var e = MyaData.get(name); return has(name) && e ? e.data : null; }

  function freshTagHtml(f, extraTitle) {
    return '<span class="fresh ' + f.state + '"' + (extraTitle ? ' title="' + h(extraTitle) + '"' : "") +
      '><span class="fresh-dot"></span>' + h(MyaLib.freshnessLabel(f)) + "</span>";
  }

  function stateBlock(name, what) {
    var f = fresh(name);
    if (f.state === "loading") return '<div class="skeleton"></div><div class="skeleton short"></div>';
    return '<div class="unconnected"><svg class="icon" aria-hidden="true"><use href="#i-plug"/></svg><span>' +
      h(what || "This") + " isn't reachable right now — nothing is shown rather than guessing.</span></div>";
  }

  function emptyBlock(text) { return '<p class="empty">' + h(text) + "</p>"; }

  function renderList(elId, source, items, renderItem, emptyText, what) {
    var el = $(elId);
    if (!el) return;
    if (!has(source) || !Array.isArray(items)) { el.innerHTML = stateBlock(source, what); return; }
    el.innerHTML = items.length ? items.map(renderItem).join("") : emptyBlock(emptyText);
  }

  function row(main, sub, side, extraClass) {
    return '<div class="row' + (extraClass ? " " + extraClass : "") + '"><div class="row-main"><strong>' + main + "</strong>" +
      (sub ? "<span>" + sub + "</span>" : "") + '</div><div class="row-side">' + (side || "") + "</div></div>";
  }

  function statusChip(status) {
    if (!status) return "";
    return '<span class="chip-tag">' + h(String(status).replace(/_/g, " ")) + "</span>";
  }

  /* ---------------- derived snapshot (only real values) ---------------- */
  function snapshot() {
    var d = payload("data");
    var approvals = payload("approvals");
    var followups = payload("followups");
    var alerts = payload("alerts");
    var s = {};
    if (approvals && Array.isArray(approvals.approvals)) {
      s.approvals = approvals.approvals.length;
      s.approvalsAtLeast = approvals.approvals.length >= APPROVALS_PAGE_LIMIT;
    }
    if (alerts && Array.isArray(alerts.alerts)) s.alerts = alerts.alerts.length;
    if (followups && typeof followups.openCount === "number") s.followUps = followups.openCount;
    if (d) {
      if (d.newLeads && !d.newLeads.error && typeof d.newLeads.value === "number") s.newLeads = d.newLeads.value;
      if (d.todaysCalls && !d.todaysCalls.error && typeof d.todaysCalls.value === "number") s.callsToday = d.todaysCalls.value;
      if (Array.isArray(d.schedule)) s.scheduleToday = d.schedule.length;
    }
    return s;
  }

  function metricTile(opts) {
    var f = fresh(opts.source);
    var known = typeof opts.value === "number" && (f.state === "live" || f.state === "stale");
    var value = known ? (opts.atLeast ? opts.value + "+" : String(opts.value)) : "—";
    var tag = opts.href ? "a" : "div";
    return "<" + tag + ' class="metric ' + (opts.tone && known && opts.value > 0 ? "tone-" + opts.tone : "") + '"' +
      (opts.href ? ' href="' + opts.href + '"' : "") + ">" +
      '<div class="metric-top"><span class="metric-label">' + h(opts.label) + "</span>" + freshTagHtml(f) + "</div>" +
      '<div class="metric-value">' + h(value) + "</div>" +
      (opts.hint ? '<div class="metric-hint">' + h(opts.hint) + "</div>" : "") +
      "</" + tag + ">";
  }

  /* ---------------- freshness tags everywhere ---------------- */
  function renderFreshTags() {
    var els = document.querySelectorAll("[data-fresh]");
    for (var i = 0; i < els.length; i++) {
      var name = els[i].getAttribute("data-fresh");
      var entry = MyaData.get(name);
      var f = fresh(name);
      var title = entry && entry.lastSuccessAt
        ? "Last updated " + new Date(entry.lastSuccessAt).toLocaleTimeString()
        : "Never loaded in this session";
      els[i].innerHTML = freshTagHtml(f, title);
    }
  }

  /* ---------------- HOME ---------------- */
  function renderHome() {
    var s = snapshot();
    var brief = MyaLib.buildBriefing(s);
    var anyStale = ["data", "approvals", "followups", "alerts"].some(function (n) { return fresh(n).state === "stale"; });
    $("home-briefing").textContent = brief.text + (brief.known && anyStale ? " Some of this is out of date — see the tags below." : "");
    $("home-briefing").classList.toggle("is-unknown", !brief.known);

    var d = payload("data");
    $("home-metrics").innerHTML = [
      metricTile({ label: "Approvals", value: s.approvals, atLeast: s.approvalsAtLeast, source: "approvals", href: "#/approvals", tone: "gold", hint: "waiting on you" }),
      metricTile({ label: "Alerts", value: s.alerts, source: "alerts", href: "#/operations", tone: "amber", hint: "overdue items" }),
      metricTile({ label: "Follow-ups", value: s.followUps, source: "followups", href: "#/operations", hint: "open" }),
      metricTile({ label: "New leads", value: s.newLeads, source: "data", href: "#/projects", hint: "marked new" }),
      metricTile({ label: "Calls today", value: s.callsToday, source: "data", href: "#/operations", hint: "since midnight ET" })
    ].join("");

    var actions = d && Array.isArray(d.workingNow) ? d.workingNow.slice(0, 5) : null;
    renderList("home-actions", "data", actions, function (t) { return "<li>" + h(t) + "</li>"; }, "No actions yet.", "Mya's action history");

    // Needs your attention: pending approvals first, then proactive alerts.
    var el = $("home-attention");
    var approvals = payload("approvals");
    var alerts = payload("alerts");
    if (!approvals && !alerts) {
      el.innerHTML = stateBlock("approvals", "Approvals");
    } else {
      var html = "";
      if (approvals && Array.isArray(approvals.approvals)) {
        html += approvals.approvals.slice(0, 3).map(function (a) {
          return row(h(a.title), h(a.detail || ""), '<a class="link-btn" href="#/approvals">Review</a>', "row-gold");
        }).join("");
      } else {
        html += stateBlock("approvals", "Approvals");
      }
      if (alerts && Array.isArray(alerts.alerts)) {
        html += alerts.alerts.map(function (a) {
          return '<div class="row row-amber"><div class="row-main"><span class="alert-text"><svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>' + h(a.message) + "</span></div></div>";
        }).join("");
      }
      var nothing = approvals && approvals.approvals && approvals.approvals.length === 0 && (!alerts || !alerts.alerts || alerts.alerts.length === 0);
      el.innerHTML = nothing ? emptyBlock("Nothing needs your attention right now.") : html;
    }

    renderList("home-schedule", "data", d && d.schedule, function (item) {
      return row(h(item.label), "", '<span class="time">' + h(item.time) + "</span>");
    }, "Nothing scheduled today.", "Today's schedule");

    var projects = payload("projects");
    renderList("home-projects", "projects", projects && projects.projects && projects.projects.slice(0, 4), projectRow, "No active projects.", "Projects");

    renderList("home-activity", "data", d && d.recentActivity, function (a) {
      return row(h(a.text), "", '<span class="time">' + h(MyaLib.formatRelative(a.time)) + "</span>");
    }, "No recent calls or intakes.", "Activity");
  }

  function projectRow(p) {
    var name = p.client_name ? h(p.project_name) + ' <span class="muted">· ' + h(p.client_name) + "</span>" : h(p.project_name);
    var next = p.next_action || p.outstanding_decisions;
    return row(name, next ? "Next: " + h(next) : '<span class="muted">No next action set</span>', statusChip(p.status));
  }

  /* ---------------- PROJECTS ---------------- */
  function renderProjects() {
    var projects = payload("projects");
    var list = projects && projects.projects;
    renderList("projects-list", "projects", list, projectRow, "No active projects on file.", "Projects");
    $("projects-note").textContent = Array.isArray(list) && list.length >= PROJECTS_PAGE_LIMIT ? "6 most recently updated" : "";

    var c = payload("contractors");
    renderList("contractors-list", "contractors", c && c.contractors, function (x) {
      return row(h(x.name) + " " + statusChip(x.category), h([x.notes, x.pricing_rate].filter(Boolean).join(" · ")), '<span class="time">' + h(x.phone || "") + "</span>");
    }, "No contractors added yet.", "Contractors");
  }

  /* ---------------- APPROVALS ---------------- */
  function approvalTypeLabel(t) {
    if (t === "notify_owner") return "Notifies you when approved";
    if (t === "send_to_customer") return "Needs manual follow-up";
    return "";
  }

  function renderApprovals() {
    var a = payload("approvals");
    var list = a && a.approvals;
    $("approvals-count").textContent = Array.isArray(list) ? (list.length >= APPROVALS_PAGE_LIMIT ? list.length + "+" : String(list.length)) : "–";
    renderList("approvals-list", "approvals", list, function (x) {
      var type = approvalTypeLabel(x.action_type);
      return '<div class="approval">' +
        '<div class="approval-body"><strong>' + h(x.title) + "</strong>" +
        (x.detail ? "<p>" + h(x.detail) + "</p>" : "") +
        '<div class="approval-meta"><span>Requested ' + h(MyaLib.formatRelative(x.requested_at)) + "</span>" +
        (type ? '<span class="chip-tag gold">' + h(type) + "</span>" : "") + "</div></div>" +
        '<div class="approval-actions">' +
        '<button type="button" class="btn approve" data-approval-id="' + h(x.id) + '" data-action="approve">Approve</button>' +
        '<button type="button" class="btn ghost" data-approval-id="' + h(x.id) + '" data-action="decline">Decline</button>' +
        "</div></div>";
    }, "Nothing is waiting on your approval.", "Approvals");

    var al = payload("alerts");
    renderList("approvals-alerts", "alerts", al && al.alerts, function (x) {
      return '<div class="row row-amber"><div class="row-main"><span class="alert-text"><svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>' + h(x.message) + "</span></div></div>";
    }, "Nothing overdue.", "Alerts");
  }

  function initApprovalActions() {
    $("approvals-list").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-approval-id]");
      if (!btn) return;
      var id = btn.getAttribute("data-approval-id");
      var action = btn.getAttribute("data-action");
      var card = btn.closest(".approval");
      var buttons = card.querySelectorAll("button");
      buttons.forEach(function (b) { b.disabled = true; });
      fetch("/api/command-center-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id, action: action })
      })
        .then(function (res) {
          if (res.status === 401) { MyaEvents.emit("auth.expired", { source: "approvals" }); return null; }
          if (!res.ok) throw new Error("failed");
          return res.json();
        })
        .then(function (result) {
          if (!result) return;
          card.classList.add("resolved");
          toast(action === "approve"
            ? (result.manualFollowUpNeeded ? "Approved — this one isn't automated yet, so follow up with the customer yourself." : "Approved.")
            : "Declined.");
          MyaData.fetch("approvals");
          MyaData.fetch("alerts");
        })
        .catch(function () {
          buttons.forEach(function (b) { b.disabled = false; });
          toast("Couldn't update that approval — try again.");
        });
    });
  }

  /* ---------------- MEMORY / CONSTELLATION ---------------- */
  function renderMemory() {
    var d = payload("data");
    var m = d && d.memoryInsights;
    var facts = payload("memory");
    var factList = facts && facts.facts;
    $("memory-metrics").innerHTML = [
      metricTile({ label: "Facts remembered", value: Array.isArray(factList) ? factList.length : null, atLeast: Array.isArray(factList) && factList.length >= 50, source: "memory" }),
      metricTile({ label: "Contacts known", value: m ? m.totalContactsRemembered : null, source: "data" }),
      metricTile({ label: "Recurring customers", value: m ? m.recurringCustomers : null, source: "data" }),
      metricTile({ label: "Profiles updated", value: m ? m.notesLoggedThisWeek : null, source: "data", hint: "this week" })
    ].join("");

    renderConstellation(factList);

    renderList("memory-facts", "memory", factList, function (f) {
      return row(h(f.fact), "", '<span class="time">' + h(MyaLib.formatRelative(f.created_at)) + "</span>");
    }, "Nothing remembered yet — tell Mya “remember that…” to teach her something.", "Memory");

    var people = d && Array.isArray(d.callerDirectory) ? MyaLib.categoryCounts(d.callerDirectory) : null;
    renderList("memory-people", "data", people, function (c) {
      return row(h(CALLER_CATEGORY_LABELS[c.category] || c.category), "", '<span class="num">' + h(c.count) + "</span>");
    }, "No callers classified yet.", "Company contacts");
  }

  function renderConstellation(facts) {
    var svg = $("constellation");
    var caption = $("constellation-caption");
    var focus = $("constellation-focus");
    var W = 640, H = 360;
    if (!has("memory") || !Array.isArray(facts)) {
      svg.innerHTML = '<text x="320" y="180" text-anchor="middle" class="constellation-empty">' +
        h(fresh("memory").state === "loading" ? "Loading…" : "Memory isn't reachable right now") + "</text>";
      caption.textContent = "";
      focus.textContent = "";
      return;
    }
    if (facts.length === 0) {
      svg.innerHTML = '<text x="320" y="180" text-anchor="middle" class="constellation-empty">No remembered facts yet</text>';
      caption.textContent = "";
      focus.textContent = "";
      return;
    }
    var pts = MyaLib.layoutConstellation(facts.length, W, H);
    var lines = "";
    for (var i = 0; i < pts.length; i++) {
      [1, 3].forEach(function (step) {
        var j = i + step;
        if (j < pts.length) lines += '<line x1="' + pts[i].x + '" y1="' + pts[i].y + '" x2="' + pts[j].x + '" y2="' + pts[j].y + '"/>';
      });
    }
    var stars = facts.map(function (f, idx) {
      var p = pts[idx];
      var r = idx < 5 ? 5 : idx < 15 ? 3.8 : 2.8; // newest facts glow brightest
      return '<g class="star" tabindex="0" role="button" data-idx="' + idx + '" aria-label="' + h(f.fact) + '">' +
        '<circle class="star-halo" cx="' + p.x + '" cy="' + p.y + '" r="' + (r * 3) + '"/>' +
        '<circle class="star-core" cx="' + p.x + '" cy="' + p.y + '" r="' + r + '"/>' +
        "<title>" + h(f.fact) + "</title></g>";
    }).join("");
    svg.innerHTML = '<g class="constellation-links">' + lines + "</g>" + stars;
    caption.textContent = facts.length + (facts.length === 1 ? " fact" : " facts") + " · newest at the center";
    focus.textContent = "Hover or tap a star to read it.";

    function show(e) {
      var g = e.target.closest(".star");
      if (!g) return;
      var f = facts[+g.getAttribute("data-idx")];
      if (f) focus.textContent = f.fact + " — " + MyaLib.formatRelative(f.created_at);
    }
    svg.onmouseover = show;
    svg.onfocusin = show;
    svg.onclick = show;
  }

  /* ---------------- OPERATIONS ---------------- */
  function renderOperations() {
    var s = snapshot();
    var d = payload("data");
    $("ops-metrics").innerHTML = [
      metricTile({ label: "Calls today", value: s.callsToday, source: "data" }),
      metricTile({ label: "Open follow-ups", value: s.followUps, source: "followups" }),
      metricTile({ label: "Alerts", value: s.alerts, source: "alerts", tone: "amber" })
    ].join("");
    renderList("ops-actions", "data", d && d.workingNow, function (t) { return "<li>" + h(t) + "</li>"; }, "No actions recorded yet.", "Mya's action history");
    renderList("ops-activity", "data", d && d.recentActivity, function (a) {
      return row(h(a.text), "", '<span class="time">' + h(MyaLib.formatRelative(a.time)) + "</span>");
    }, "No recent calls or intakes.", "Activity");
    var al = payload("alerts");
    renderList("ops-alerts", "alerts", al && al.alerts, function (x) {
      return '<div class="row row-amber"><div class="row-main"><span class="alert-text"><svg class="icon" aria-hidden="true"><use href="#i-alert"/></svg>' + h(x.message) + "</span></div></div>";
    }, "Nothing overdue.", "Alerts");
  }

  /* ---------------- DEVICES ---------------- */
  var micState = { micEnabled: false, supported: true };
  var voiceState = { voiceEnabled: true };

  function renderDevices() {
    var standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
    var sw = "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "Active" : "Not active") : "Not supported";
    var rows = [
      ["Connection", navigator.onLine ? "Online" : "Offline"],
      ["Installed as app", standalone ? "Yes" : "No — use your browser's Install / Add to Home Screen"],
      ["Voice input (wake word)", micState.supported ? (micState.micEnabled ? "On" : "Off") : "Not supported in this browser"],
      ["Mya's spoken replies", voiceState.voiceEnabled ? "On" : "Muted"],
      ["Offline app shell", sw],
      ["Screen", window.innerWidth + " × " + window.innerHeight]
    ];
    $("device-this").innerHTML = rows.map(function (r) { return "<dt>" + h(r[0]) + "</dt><dd>" + h(r[1]) + "</dd>"; }).join("");
  }

  /* ---------------- SYSTEMS ---------------- */
  function renderSystems() {
    var tbody = document.querySelector("#sources-table tbody");
    tbody.innerHTML = Object.keys(MyaData.SOURCES).map(function (name) {
      var src = MyaData.SOURCES[name];
      var e = MyaData.get(name);
      return "<tr><td>" + h(src.label) + "</td><td>" + freshTagHtml(fresh(name)) + "</td><td>" +
        h(e.lastSuccessAt ? MyaLib.formatRelative(e.lastSuccessAt) : "Never") +
        (e.lastError && e.lastAttemptAt > e.lastSuccessAt ? ' <span class="muted small">(last try failed)</span>' : "") +
        '</td><td class="hide-sm"><code>' + h(src.url) + "</code></td></tr>";
    }).join("");

    var d = payload("data");
    renderList("services-list", "data", d && d.services, function (sv) {
      return row(h(sv.name), h(sv.detail || ""),
        '<span class="fresh ' + (sv.connected ? "live" : "offline") + '"><span class="fresh-dot"></span>' + (sv.connected ? "Configured" : "Not configured") + "</span>");
    }, "No services reported.", "Service status");

    $("integrations-list").innerHTML = MyaData.INTEGRATIONS.map(function (i) {
      return row(h(i.name), h(i.role), '<span class="fresh offline"><span class="fresh-dot"></span>Not connected</span>');
    }).join("");
  }

  function renderIntegrationCards() {
    var cards = document.querySelectorAll("[data-integration]");
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute("data-integration");
      var info = MyaData.INTEGRATIONS.filter(function (x) { return x.id === id; })[0];
      if (!info) continue;
      cards[i].classList.add("unconnected-card");
      cards[i].innerHTML = '<div class="card-head"><h2>' + h(info.name) + '</h2><span class="fresh offline"><span class="fresh-dot"></span>Not connected</span></div>' +
        '<p class="muted small">' + h(info.role) + "</p>";
    }
  }

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(text) {
    var el = $("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 5000);
  }

  function renderAll() {
    renderHome();
    renderProjects();
    renderApprovals();
    renderMemory();
    renderOperations();
    renderDevices();
    renderSystems();
    renderFreshTags();
  }

  var renderQueued = false;
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderAll(); });
  }

  function init() {
    renderIntegrationCards();
    initApprovalActions();
    MyaEvents.on("data.changed", queueRender);
    MyaEvents.on("mic.changed", function (s) { micState = s; renderDevices(); });
    MyaEvents.on("voice.changed", function (s) { voiceState = s; renderDevices(); });
    window.addEventListener("online", renderDevices);
    window.addEventListener("offline", renderDevices);
    // Ages move even when nothing refetches: re-evaluate Live -> Stale.
    setInterval(queueRender, 15000);
    renderAll();
  }

  global.MyaViews = { init: init, renderAll: renderAll, snapshot: snapshot, toast: toast };
})(window);
