/**
 * Mya Command Center — Phase 1
 * Renders SAMPLE_DATA (from sample-data.js) into the page.
 * No network requests. No real data. Nothing here is a working control yet.
 */

(function () {
  "use strict";

  /* ---------------- Clock (Atlanta / America/New_York) ---------------- */
  function updateClock() {
    const now = new Date();
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    const dateFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    document.getElementById("clock").textContent = timeFmt.format(now) + " ET";
    document.getElementById("clock-date").textContent = dateFmt.format(now);
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ---------------- Small helpers ---------------- */
  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function sparklinePath(values, width, height) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function sparkSVG(values) {
    const w = 140, h = 34;
    const linePath = sparklinePath(values, w, h);
    const fillPath = `${linePath} L${w},${h} L0,${h} Z`;
    return `
      <svg class="kpi-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2fb2ff" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#2fb2ff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path class="spark-fill" d="${fillPath}"></path>
        <path d="${linePath}"></path>
      </svg>`;
  }

  /* ---------------- KPI row ---------------- */
  function renderKPIs() {
    const container = document.getElementById("kpi-row");
    const items = [
      { label: "Today's Calls", key: "todaysCalls" },
      { label: "New Leads", key: "newLeads" },
      { label: "Follow-Ups Due", key: "followUpsDue" },
      { label: "Open Projects", key: "openProjects" }
    ];
    items.forEach(({ label, key }) => {
      const data = SAMPLE_DATA.kpis[key];
      const card = el("div", "kpi-card");
      card.innerHTML = `
        <div class="kpi-top">
          <span class="kpi-label">${label}</span>
          <span class="sample-badge">SAMPLE DATA</span>
        </div>
        <div class="kpi-value">${data.value}</div>
        ${sparkSVG(data.trend)}
      `;
      container.appendChild(card);
    });
  }

  /* ---------------- System status ---------------- */
  function renderStatus() {
    const container = document.getElementById("status-list");
    SAMPLE_DATA.systemStatus.forEach((item) => {
      const row = el("div", "status-row");
      const dotClass = item.state === "online" ? "dot-online" : "dot-offline";
      row.innerHTML = `
        <div class="status-row-left">
          <span class="dot ${dotClass}"></span>
          <div>
            <div class="status-name">${item.name}</div>
            <div class="status-detail">${item.detail}</div>
          </div>
        </div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Activity feed ---------------- */
  function renderActivity() {
    const container = document.getElementById("activity-list");
    SAMPLE_DATA.activityFeed.forEach((item) => {
      const row = el("div", `activity-item sev-${item.severity}`);
      row.innerHTML = `
        <div class="activity-time">${item.time}</div>
        <div class="activity-text">${item.text}</div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Approvals ---------------- */
  function renderApprovals() {
    const container = document.getElementById("approvals-list");
    SAMPLE_DATA.approvals.forEach((item) => {
      const card = el("div", "approval-card");
      card.innerHTML = `
        <div class="approval-text">
          <strong>${item.title}</strong>
          <span>${item.detail}</span>
          <div class="approval-meta">Requested ${item.requestedAgo}</div>
        </div>
        <div class="approval-actions">
          <button class="btn-approve" type="button" disabled>Approve</button>
          <button class="btn-decline" type="button" disabled>Decline</button>
        </div>
      `;
      container.appendChild(card);
    });
  }

  /* ---------------- Working now ---------------- */
  function renderWorkingNow() {
    const container = document.getElementById("working-list");
    SAMPLE_DATA.workingNow.forEach((text) => {
      const li = el("li", null, text);
      container.appendChild(li);
    });
  }

  /* ---------------- Today's calls ---------------- */
  function renderCalls() {
    const container = document.getElementById("calls-list");
    SAMPLE_DATA.todaysCalls.forEach((c) => {
      const row = el("div", "list-row");
      row.innerHTML = `
        <div class="list-row-main">
          <strong>${c.name}</strong>
          <span>${c.topic}</span>
        </div>
        <div class="list-row-side">${c.time}<br>${c.outcome}</div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Follow-ups timeline ---------------- */
  function renderFollowUps() {
    const container = document.getElementById("followups-list");
    SAMPLE_DATA.followUpsDue.forEach((f) => {
      const item = el("div", "timeline-item");
      item.innerHTML = `
        <div class="timeline-when">${f.when}</div>
        <div class="timeline-name">${f.name}</div>
        <div class="timeline-note">${f.note}</div>
      `;
      container.appendChild(item);
    });
  }

  /* ---------------- New leads ---------------- */
  function renderLeads() {
    const container = document.getElementById("leads-list");
    SAMPLE_DATA.newLeads.forEach((l) => {
      const row = el("div", "list-row");
      row.innerHTML = `
        <div class="list-row-main">
          <strong>${l.name}</strong>
          <span>${l.interest} · ${l.source}</span>
        </div>
        <div class="list-row-side">${l.receivedAgo}</div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Projects needing attention ---------------- */
  function renderProjects() {
    const container = document.getElementById("projects-list");
    SAMPLE_DATA.projectsNeedingAttention.forEach((p) => {
      const row = el("div", "list-row");
      row.innerHTML = `
        <div class="list-row-main">
          <strong>${p.name}</strong>
          <span>${p.issue}</span>
        </div>
        <div class="list-row-side">${p.days} day${p.days === 1 ? "" : "s"}</div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Recent activity ---------------- */
  function renderRecentActivity() {
    const container = document.getElementById("recent-activity-list");
    SAMPLE_DATA.recentActivity.forEach((r) => {
      const row = el("div", "list-row");
      row.innerHTML = `
        <div class="list-row-main">
          <strong>${r.time}</strong>
          <span>${r.text}</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Memory insights ---------------- */
  function renderMemory() {
    const container = document.getElementById("memory-stats");
    const m = SAMPLE_DATA.memoryInsights;
    const rows = [
      { num: m.totalContactsRemembered, label: "Contacts remembered" },
      { num: m.recurringCustomers, label: "Recurring customers" },
      { num: m.notesLoggedThisWeek, label: "Notes logged this week" }
    ];
    rows.forEach((r) => {
      const row = el("div", "memory-stat");
      row.innerHTML = `<span class="num">${r.num}</span><span class="label">${r.label}</span>`;
      container.appendChild(row);
    });
  }

  /* ---------------- Init ---------------- */
  renderKPIs();
  renderStatus();
  renderActivity();
  renderApprovals();
  renderWorkingNow();
  renderCalls();
  renderFollowUps();
  renderLeads();
  renderProjects();
  renderRecentActivity();
  renderMemory();
})();
