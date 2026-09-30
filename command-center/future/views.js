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
    var sys = payload("systems");
    var down = MyaLib.systemsDown(sys && sys.systems, fresh("systems"));
    if (down.length) s.systemsDown = down;
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
    var html = row(name, next ? "Next: " + h(next) : '<span class="muted">No next action set</span>', statusChip(p.status));
    if (!p.id) return html;
    return '<div class="row-link" role="button" tabindex="0" data-project-id="' + h(p.id) + '" aria-label="Open ' + h(p.project_name) + '">' + html + "</div>";
  }

  /* ---------------- PROJECTS ---------------- */
  var projectSearch = "";
  var openProjectId = null;

  function renderProjects() {
    if (projectSearch) {
      var sr = MyaData.get("projectSearch");
      var results = sr && sr.data && sr.data.projects;
      $("projects-list-title").textContent = "Search results";
      renderList("projects-list", "projectSearch", results, projectRow, "No projects match “" + projectSearch + "”.", "Project search");
      var cap = sr && sr.data && sr.data.limit;
      $("projects-note").textContent = Array.isArray(results) && cap && results.length >= cap ? "First " + cap + " matches" : "All statuses";
    } else {
      var projects = payload("projects");
      var list = projects && projects.projects;
      $("projects-list-title").textContent = "Active projects";
      renderList("projects-list", "projects", list, projectRow, "No active projects on file.", "Projects");
      $("projects-note").textContent = Array.isArray(list) && list.length >= PROJECTS_PAGE_LIMIT ? "6 most recently updated" : "";
    }
    renderProjectDetail();

    var c = payload("contractors");
    renderList("contractors-list", "contractors", c && c.contractors, function (x) {
      return row(h(x.name) + " " + statusChip(x.category), h([x.notes, x.pricing_rate].filter(Boolean).join(" · ")), '<span class="time">' + h(x.phone || "") + "</span>");
    }, "No contractors added yet.", "Contractors");
  }

  /* ---------------- PROJECT DETAIL ---------------- */
  // Known mya_projects columns shown in a fixed order; anything null or
  // missing is simply left out (unknown is never shown as blank-but-real).
  var PROJECT_FIELDS = [
    ["client_name", "Client"], ["status", "Status"], ["project_type", "Type"], ["address", "Address"],
    ["next_action", "Next action"], ["next_action_due", "Next action due"],
    ["outstanding_decisions", "Outstanding decisions"], ["original_scope", "Original scope"],
    ["revised_scope", "Revised scope"], ["current_estimate", "Current estimate"],
    ["payment_terms", "Payment terms"], ["warranty_terms", "Warranty terms"], ["notes", "Notes"]
  ];

  function money(n) {
    var v = Number(n);
    return isFinite(v) ? "$" + v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
  }

  function renderProjectDetail() {
    var card = $("project-detail");
    if (!openProjectId) { card.hidden = true; return; }
    card.hidden = false;
    var f = fresh("projectDetail");
    $("project-detail-fresh").innerHTML = freshTagHtml(f);
    var entry = MyaData.get("projectDetail");
    var body = $("project-detail-body");
    var d = entry && entry.data;
    if (!d || !d.project) {
      body.innerHTML = f.state === "loading" ? stateBlock("projectDetail")
        : entry && entry.status === 404 ? emptyBlock("That project isn't on file anymore.")
        : stateBlock("projectDetail", "This project");
      return;
    }
    var p = d.project;
    $("project-detail-title").textContent = p.project_name || "Project";
    var kv = PROJECT_FIELDS.filter(function (fd) { return p[fd[0]] != null && String(p[fd[0]]).trim() !== ""; }).map(function (fd) {
      var v = fd[0] === "current_estimate" ? money(p[fd[0]]) || p[fd[0]] : fd[0] === "status" ? String(p[fd[0]]).replace(/_/g, " ") : p[fd[0]];
      return "<dt>" + h(fd[1]) + "</dt><dd>" + h(typeof v === "object" ? JSON.stringify(v) : v) + "</dd>";
    }).join("");
    var items = Array.isArray(d.estimateItems)
      ? (d.estimateItems.length ? d.estimateItems.map(function (i) {
          return row(h(i.description || i.category || "Line item"), h([i.category, i.quantity != null ? i.quantity + " " + (i.unit || "") : ""].filter(Boolean).join(" · ")),
            '<span class="num">' + h(money(i.line_total)) + "</span>");
        }).join("") + (typeof d.directCost === "number" ? row("<span class=\"muted\">Direct cost</span>", "", '<span class="num">' + h(money(d.directCost)) + "</span>") : "")
        : emptyBlock("No estimate line items logged yet."))
      : '<p class="muted small">Estimate items couldn\'t be loaded — nothing is shown rather than guessing.</p>';
    var upcoming = Array.isArray(d.upcoming)
      ? (d.upcoming.length ? d.upcoming.map(function (a) {
          return row(h(a.title), h(a.notes || ""), '<span class="time">' + h(new Date(a.scheduled_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })) + "</span>");
        }).join("") : emptyBlock("Nothing scheduled for this project."))
      : '<p class="muted small">Appointments couldn\'t be loaded — nothing is shown rather than guessing.</p>';
    body.innerHTML =
      '<div class="grid-2 detail-grid"><div><dl class="kv">' + (kv || "<dt>On file</dt><dd>Only the name so far.</dd>") + "</dl>" +
      (p.updated_at ? '<p class="muted small detail-updated">Updated ' + h(MyaLib.formatRelative(p.updated_at)) + "</p>" : "") +
      '<button type="button" class="btn approve" id="project-ask-mya">Ask Mya about this project</button></div>' +
      '<div><h3 class="detail-sub">Estimate</h3>' + items + '<h3 class="detail-sub">Upcoming</h3>' + upcoming + "</div></div>";
  }

  function openProject(id) {
    openProjectId = id;
    MyaData.query("projectDetail", "/api/command-center-projects?type=detail&id=" + encodeURIComponent(id));
    renderProjectDetail();
    var card = $("project-detail");
    if (card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Row "buttons" are divs (a block row can't live inside <button>), so
  // Enter/Space activate them like a real button.
  function activateOnKey(el) {
    el.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-project-id]")) {
        e.preventDefault();
        e.target.closest("[data-project-id]").click();
      }
    });
  }

  function initProjects() {
    activateOnKey($("projects-list"));
    activateOnKey($("home-projects"));
    $("projects-list").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-project-id]");
      if (btn) openProject(btn.getAttribute("data-project-id"));
    });
    $("home-projects").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-project-id]");
      if (!btn) return;
      location.hash = "#/projects";
      openProject(btn.getAttribute("data-project-id"));
    });
    $("project-detail-close").addEventListener("click", function () {
      openProjectId = null;
      MyaData.clearQuery("projectDetail");
      renderProjectDetail();
    });
    $("project-detail-body").addEventListener("click", function (e) {
      if (!e.target.closest("#project-ask-mya")) return;
      var entry = MyaData.get("projectDetail");
      var name = entry && entry.data && entry.data.project && entry.data.project.project_name;
      if (!name) return;
      var d = entry && entry.data;
      var c = MyaLib.buildScreenContext("projects", { projectDetail: { state: fresh("projectDetail").state, data: d } });
      location.hash = "#/mya";
      MyaChat.send("What's the latest on " + name + "?", { label: name, context: c.text });
    });
    $("projects-search-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = $("projects-search-input").value.trim();
      if (!q) return;
      projectSearch = q;
      $("projects-search-clear").hidden = false;
      MyaData.query("projectSearch", "/api/command-center-projects?type=search&q=" + encodeURIComponent(q));
    });
    $("projects-search-clear").addEventListener("click", function () {
      projectSearch = "";
      $("projects-search-input").value = "";
      $("projects-search-clear").hidden = true;
      MyaData.clearQuery("projectSearch");
    });
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

    var rec = payload("approvalsRecent");
    renderList("approvals-recent", "approvalsRecent", rec && rec.approvals, function (x) {
      var approved = x.status === "approved";
      return row(h(x.title), h(x.resolved_at ? MyaLib.formatRelative(x.resolved_at) : ""),
        '<span class="chip-tag' + (approved ? " gold" : "") + '">' + (approved ? "Approved" : "Declined") + "</span>");
    }, "Nothing resolved yet.", "Approval history");

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
      // On a phone a mis-tap is easy; confirm before anything is resolved.
      if (window.matchMedia("(max-width: 899px)").matches) {
        var title = card.querySelector("strong");
        if (!window.confirm((action === "approve" ? "Approve" : "Decline") + " “" + (title ? title.textContent : "this request") + "”?")) return;
      }
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
          MyaData.fetch("approvalsRecent");
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
    renderHindsight();

    renderList("memory-facts", "memory", factList, function (f) {
      return row(h(f.fact), "", '<span class="time">' + h(MyaLib.formatRelative(f.created_at)) + "</span>");
    }, "Nothing remembered yet — tell Mya “remember that…” to teach her something.", "Memory");

    var people = d && Array.isArray(d.callerDirectory) ? MyaLib.categoryCounts(d.callerDirectory) : null;
    renderList("memory-people", "data", people, function (c) {
      return row(h(CALLER_CATEGORY_LABELS[c.category] || c.category), "", '<span class="num">' + h(c.count) + "</span>");
    }, "No callers classified yet.", "Company contacts");
  }

  function systemById(id) {
    var sys = payload("systems");
    var list = sys && Array.isArray(sys.systems) ? sys.systems : [];
    return list.filter(function (x) { return x && x.id === id; })[0] || null;
  }

  var hindsightAsked = "";

  function renderHindsight() {
    var st = MyaLib.integrationStatus(systemById("hindsight"), fresh("systems"));
    // The search box only exists when a live check says Hindsight answers --
    // never a control that can't do anything.
    var usable = st.state === "up";
    $("hindsight-form").hidden = !usable;
    var out = $("hindsight-results");
    var tag = $("hindsight-fresh");
    if (!hindsightAsked) {
      tag.innerHTML = "";
      out.innerHTML = usable ? "" : '<div class="unconnected"><svg class="icon" aria-hidden="true"><use href="#i-plug"/></svg><span>' +
        h(st.state === "loading" ? "Checking whether Hindsight is reachable…"
          : st.state === "not_configured" ? "Hindsight isn't configured for the Command Center yet, so there's nothing to search."
          : "Hindsight isn't reachable from here right now (" + st.label + "), so search is off rather than guessing.") + "</span></div>";
      return;
    }
    var f = fresh("hindsight");
    tag.innerHTML = freshTagHtml(f);
    var entry = MyaData.get("hindsight");
    var mems = entry && entry.data && entry.data.memories;
    if (!Array.isArray(mems)) {
      out.innerHTML = f.state === "loading" ? stateBlock("hindsight")
        : entry && entry.status === 503 ? '<p class="muted small">Hindsight isn\'t configured for the Command Center.</p>'
        : stateBlock("hindsight", "Hindsight");
      return;
    }
    out.innerHTML = mems.length
      ? mems.map(function (m) { return row(h(m.text), "", m.type ? '<span class="chip-tag">' + h(m.type) + "</span>" : ""); }).join("")
      : emptyBlock("Hindsight has nothing on “" + hindsightAsked + "”.");
  }

  function initHindsight() {
    $("hindsight-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = $("hindsight-q").value.trim();
      if (!q) return;
      hindsightAsked = q;
      MyaData.query("hindsight", "/api/command-center-memory?type=hindsight&q=" + encodeURIComponent(q));
    });
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

    var sys = payload("systems");
    var list = sys && Array.isArray(sys.systems) ? sys.systems : null;
    var CORE = ["supabase", "anthropic", "voice", "phone"];
    renderList("services-list", "systems", list && list.filter(function (x) { return CORE.indexOf(x.id) !== -1; }), systemRow,
      "No services reported.", "System health");
    // External integrations: every described system is listed, whether or
    // not the server reported it -- an unreported one reads Not observable.
    var external = list ? MyaData.INTEGRATIONS.map(function (i) {
      return systemById(i.id) || { id: i.id, name: i.name, status: "not_observable", detail: i.role };
    }) : null;
    renderList("integrations-list", "systems", external, systemRow, "No integrations reported.", "System health");
  }

  function systemPill(system) {
    var st = MyaLib.integrationStatus(system, fresh("systems"));
    return '<span class="fresh ' + st.cls + '"><span class="fresh-dot"></span>' + h(st.label) + "</span>";
  }

  function systemSub(system) {
    var bits = [system.detail || ""];
    if (system.lastActivityAt) bits.push("Last activity " + MyaLib.formatRelative(system.lastActivityAt));
    if (typeof system.latencyMs === "number" && system.status === "up") bits.push(system.latencyMs + " ms");
    return bits.filter(Boolean).join(" · ");
  }

  function systemRow(system) {
    return row(h(system.name), h(systemSub(system)), systemPill(system));
  }

  function renderIntegrationCards() {
    var cards = document.querySelectorAll("[data-integration]");
    for (var i = 0; i < cards.length; i++) {
      var id = cards[i].getAttribute("data-integration");
      var info = MyaData.INTEGRATIONS.filter(function (x) { return x.id === id; })[0];
      if (!info) continue;
      var system = systemById(id);
      var st = MyaLib.integrationStatus(system, fresh("systems"));
      cards[i].classList.toggle("unconnected-card", st.state !== "up");
      var detail = system ? systemSub(system) : "";
      cards[i].innerHTML = '<div class="card-head"><h2>' + h(info.name) + "</h2>" + systemPill(system) + "</div>" +
        '<p class="muted small">' + h(info.role) + "</p>" +
        (detail && detail !== info.role ? '<p class="small integration-detail">' + h(detail) + "</p>" : "");
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
    renderIntegrationCards();
    renderFreshTags();
  }

  var renderQueued = false;
  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () { renderQueued = false; renderAll(); });
  }

  function init() {
    initApprovalActions();
    initProjects();
    initHindsight();
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
