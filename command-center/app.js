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

  function setLiveBadge(contentElId, isLive) {
    const content = document.getElementById(contentElId);
    if (!content) return;
    const panel = content.closest(".panel");
    if (!panel) return;
    const badge = panel.querySelector(".sample-badge, .live-badge");
    if (!badge) return;
    if (isLive) {
      badge.textContent = "LIVE";
      badge.className = "live-badge";
    } else {
      badge.textContent = "SAMPLE DATA";
      badge.className = "sample-badge";
    }
  }

  function formatRelative(iso) {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
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
  function renderKPIs(liveValues) {
    liveValues = liveValues || {};
    const container = document.getElementById("kpi-row");
    container.innerHTML = "";
    const items = [
      { label: "Today's Calls", key: "todaysCalls" },
      { label: "New Leads", key: "newLeads" },
      { label: "Follow-Ups Due", key: "followUpsDue" },
      { label: "Open Projects", key: "openProjects" }
    ];
    items.forEach(({ label, key }) => {
      const sample = SAMPLE_DATA.kpis[key];
      const live = liveValues[key];
      const card = el("div", "kpi-card");
      if (live && typeof live.value === "number") {
        card.innerHTML = `
          <div class="kpi-top">
            <span class="kpi-icon">${sample.icon}</span>
            <span class="live-badge">LIVE</span>
          </div>
          <div class="kpi-value">${live.value}</div>
          <div class="kpi-label">${label}</div>
          <div class="kpi-trend" style="color:var(--text-low);">Updated just now</div>
        `;
      } else {
        card.innerHTML = `
          <div class="kpi-top">
            <span class="kpi-icon">${sample.icon}</span>
            <span class="sample-badge">SAMPLE DATA</span>
          </div>
          <div class="kpi-value">${sample.value}</div>
          <div class="kpi-label">${label}</div>
          <div class="kpi-trend ${sample.trendDirection}">${sample.trendDirection === "up" ? "↑" : "↓"} ${sample.trendText}</div>
          ${sparkSVG(sample.trend)}
        `;
      }
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
  function renderActivity(items, isLive) {
    const container = document.getElementById("activity-list");
    container.innerHTML = "";
    (items || SAMPLE_DATA.activityFeed).forEach((item) => {
      const row = el("div", `activity-item sev-${item.severity || "info"}`);
      row.innerHTML = `
        <div class="activity-time">${item.time}</div>
        <div class="activity-text">${item.text}</div>
      `;
      container.appendChild(row);
    });
    setLiveBadge("activity-list", Boolean(isLive));
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
  function renderLeads(items, isLive) {
    const container = document.getElementById("leads-list");
    container.innerHTML = "";
    (items || SAMPLE_DATA.newLeads).forEach((l) => {
      const row = el("div", "list-row");
      row.innerHTML = `
        <div class="list-row-main">
          <strong>${l.name}</strong>
          <span>${l.interest || "—"} · ${l.source || "—"}</span>
        </div>
        <div class="list-row-side">${l.receivedAgo}</div>
      `;
      container.appendChild(row);
    });
    setLiveBadge("leads-list", Boolean(isLive));
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
  function renderMemory(overrides, isLive) {
    const container = document.getElementById("memory-stats");
    container.innerHTML = "";
    const m = Object.assign({}, SAMPLE_DATA.memoryInsights, overrides || {});
    const rows = [
      { num: m.totalContactsRemembered, label: "Contacts remembered" },
      { num: m.recurringCustomers, label: "Recurring customers" },
      { num: m.notesLoggedThisWeek, label: "Notes logged this week" }
    ];
    rows.forEach((r) => {
      const row = el("div", "memory-stat");
      row.innerHTML = `<span class="num">${r.num ?? "—"}</span><span class="label">${r.label}</span>`;
      container.appendChild(row);
    });
    setLiveBadge("memory-stats", Boolean(isLive));
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

  /* ---------------- Live data (Phase 2) ----------------
     Only ever attempted when the page is served over http(s) from Vercel —
     opening index.html directly as a local file (file://) cannot fetch a
     relative /api/ path, so it always falls back to sample data untouched.
     A wrong or missing access key also falls back to sample data; nothing
     here is required for the dashboard to work. */
  const LIVE_ENDPOINT = "/api/command-center-data";
  const KEY_STORAGE_KEY = "cc_key";

  function getStoredKey() {
    try { return sessionStorage.getItem(KEY_STORAGE_KEY); } catch (e) { return null; }
  }
  function storeKey(key) {
    try { sessionStorage.setItem(KEY_STORAGE_KEY, key); } catch (e) { /* ignore */ }
  }
  function clearStoredKey() {
    try { sessionStorage.removeItem(KEY_STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  async function fetchLiveData(key) {
    const res = await fetch(LIVE_ENDPOINT, { headers: { "x-cc-key": key } });
    if (!res.ok) {
      throw new Error(res.status === 401 ? "Invalid access key." : `Server error (${res.status}).`);
    }
    return res.json();
  }

  function applyLiveData(data) {
    renderKPIs({
      todaysCalls: data.todaysCalls,
      newLeads: data.newLeads
    });

    if (data.newLeads && Array.isArray(data.newLeads.recent) && data.newLeads.recent.length) {
      renderLeads(
        data.newLeads.recent.map((l) => ({
          name: l.name,
          interest: l.interest,
          source: l.source,
          receivedAgo: formatRelative(l.receivedAt)
        })),
        true
      );
    }

    if (Array.isArray(data.recentActivity) && data.recentActivity.length) {
      renderActivity(
        data.recentActivity.map((a) => ({
          time: formatRelative(a.time),
          text: a.text,
          severity: "info"
        })),
        true
      );
    }

    if (data.memoryInsights) {
      renderMemory(data.memoryInsights, true);
    }
  }

  function initLiveConnect() {
    if (location.protocol === "file:") return;

    const bar = document.getElementById("connect-bar");
    const input = document.getElementById("connect-key-input");
    const btn = document.getElementById("connect-btn");
    const status = document.getElementById("connect-status");
    if (!bar || !input || !btn || !status) return;

    async function attempt(key, silent) {
      try {
        const data = await fetchLiveData(key);
        storeKey(key);
        applyLiveData(data);
        status.textContent = "Connected — showing live data.";
        status.className = "connect-status success";
        bar.hidden = true;
      } catch (err) {
        clearStoredKey();
        bar.hidden = false;
        if (!silent) {
          status.textContent = err.message || "Could not connect.";
          status.className = "connect-status error";
        }
      }
    }

    const savedKey = getStoredKey();
    if (savedKey) {
      attempt(savedKey, true);
    } else {
      bar.hidden = false;
    }

    btn.addEventListener("click", () => {
      const key = input.value.trim();
      if (!key) return;
      attempt(key, false);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
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
  initLiveConnect();
})();
