/**
 * Mya Command Center — Phase 1
 * Renders SAMPLE_DATA (from sample-data.js) into the page.
 * No network requests. No real data. Nothing here is a working control yet.
 */

(function () {
  "use strict";

  const ATLANTA_TZ = "America/New_York";

  /* ---------------- Clock + greeting (Atlanta / America/New_York) ---------------- */
  function partOfDay(hour) {
    if (hour < 12) return "Morning";
    if (hour < 18) return "Afternoon";
    return "Evening";
  }

  function updateClock() {
    const now = new Date();
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ATLANTA_TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
    const dateFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ATLANTA_TZ,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
    const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: ATLANTA_TZ, hour: "numeric", hour12: false });
    const hour = parseInt(hourFmt.format(now), 10);

    document.getElementById("clock").textContent = timeFmt.format(now) + " ET";
    document.getElementById("clock-date").textContent = dateFmt.format(now);
    document.getElementById("greeting-title").textContent =
      `Good ${partOfDay(hour)}, ${SAMPLE_DATA.owner.firstName}`;
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
    const w = 140, h = 28;
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

  /* ---------------- Mya message ---------------- */
  function renderMyaMessage() {
    const leads = SAMPLE_DATA.kpis.newLeads.value;
    const followUps = SAMPLE_DATA.kpis.followUpsDue.value;
    const approvals = SAMPLE_DATA.approvals.length;
    document.getElementById("mya-message-text").textContent =
      `You have ${leads} new leads, ${followUps} follow-ups due today, and ${approvals} item${approvals === 1 ? "" : "s"} ` +
      `waiting on your approval. I'm keeping an eye on calls, follow-ups, and your schedule.`;
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
          <span class="kpi-icon">${data.icon}</span>
          <span class="sample-badge">SAMPLE DATA</span>
        </div>
        <div class="kpi-value">${data.value}</div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-trend ${data.trendDirection}">${data.trendDirection === "up" ? "↑" : "↓"} ${data.trendText}</div>
        ${sparkSVG(data.trend)}
      `;
      container.appendChild(card);
    });
  }

  /* ---------------- Today's schedule ---------------- */
  function renderSchedule() {
    const container = document.getElementById("schedule-list");
    SAMPLE_DATA.todaysSchedule.forEach((s) => {
      const item = el("div", "timeline-item");
      item.innerHTML = `
        <div class="timeline-when">${s.time}</div>
        <div class="timeline-name">${s.label}</div>
      `;
      container.appendChild(item);
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
    document.getElementById("approvals-count").textContent = SAMPLE_DATA.approvals.length;
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

  /* ---------------- Connected services ---------------- */
  function renderServices() {
    const container = document.getElementById("services-list");
    SAMPLE_DATA.connectedServices.forEach((s) => {
      const row = el("div", "service-row");
      const statusClass = s.connected ? "on" : "off";
      row.innerHTML = `
        <div class="service-row-left">
          <span class="service-name">${s.name}</span>
          <span class="service-detail">${s.detail}</span>
        </div>
        <span class="service-status ${statusClass}">
          <span class="dot ${s.connected ? "dot-online" : "dot-offline"}"></span>
          ${s.connected ? "Connected" : "Not Connected"}
        </span>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Devices ---------------- */
  function renderDevices() {
    const container = document.getElementById("devices-list");
    SAMPLE_DATA.devices.forEach((d) => {
      const row = el("div", "service-row");
      const isOnline = d.status === "online";
      row.innerHTML = `
        <div class="service-row-left">
          <span class="service-name">${d.name}</span>
        </div>
        <span class="service-status ${isOnline ? "on" : "off"}">
          <span class="dot ${isOnline ? "dot-online" : "dot-offline"}"></span>
          ${isOnline ? "Online" : "Offline"}
        </span>
      `;
      container.appendChild(row);
    });
  }

  /* ---------------- Quick actions ---------------- */
  function renderQuickActions() {
    const container = document.getElementById("quick-actions");
    SAMPLE_DATA.quickActions.forEach((a) => {
      const btn = el("button", "qa-btn");
      btn.type = "button";
      btn.disabled = true;
      btn.innerHTML = `
        <span class="qa-icon">${a.icon}</span>
        ${a.label}
        <span class="tooltip">Not connected yet — display only.</span>
      `;
      container.appendChild(btn);
    });
  }

  /* ---------------- Init ---------------- */
  renderMyaMessage();
  renderKPIs();
  renderSchedule();
  renderActivity();
  renderApprovals();
  renderWorkingNow();
  renderLeads();
  renderProjects();
  renderMemory();
  renderServices();
  renderDevices();
  renderQuickActions();
})();
