/**
 * Mya Command Center — Phase 1
 * Renders SAMPLE_DATA (from sample-data.js) into the page.
 * No network requests. No real data. Nothing here is a working control yet.
 */

(function () {
  "use strict";

  const ATLANTA_TZ = "America/New_York";
  let ownerFirstName = SAMPLE_DATA.owner.firstName;

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
      `Good ${partOfDay(hour)}, ${ownerFirstName}`;
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
  function renderApprovals(items, isLive) {
    const container = document.getElementById("approvals-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.approvals;
    document.getElementById("approvals-count").textContent = list.length;

    if (isLive && list.length === 0) {
      container.innerHTML = `<div class="approval-empty">Nothing needs your attention right now.</div>`;
      setLiveBadge("approvals-list", true);
      return;
    }

    list.forEach((item) => {
      const card = el("div", "approval-card");
      const meta = isLive ? `Requested ${formatRelative(item.requestedAt)}` : `Requested ${item.requestedAgo}`;
      const actionAttrs = isLive
        ? `data-id="${item.id}" data-action="approve"`
        : "disabled";
      const declineAttrs = isLive
        ? `data-id="${item.id}" data-action="decline"`
        : "disabled";
      const typeLabel = approvalTypeLabel(item.actionType);
      card.innerHTML = `
        <div class="approval-text">
          <strong>${item.title}</strong>
          <span>${item.detail || ""}</span>
          <div class="approval-meta">${meta}</div>
          ${typeLabel ? `<span class="approval-type-tag">${typeLabel}</span>` : ""}
        </div>
        <div class="approval-actions">
          <button class="btn-approve" type="button" ${actionAttrs}>Approve</button>
          <button class="btn-decline" type="button" ${declineAttrs}>Decline</button>
        </div>
      `;
      container.appendChild(card);
    });
    setLiveBadge("approvals-list", Boolean(isLive));
  }

  function approvalTypeLabel(actionType) {
    if (actionType === "notify_owner") return "Notifies you when approved";
    if (actionType === "send_to_customer") return "Needs manual follow-up";
    return "";
  }

  function showApprovalToast(message) {
    const toast = document.getElementById("approval-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showApprovalToast._t);
    showApprovalToast._t = setTimeout(() => { toast.hidden = true; }, 6000);
  }

  async function handleApprovalAction(id, action, buttonEl) {
    const card = buttonEl.closest(".approval-card");
    const title = card.querySelector(".approval-text strong")?.textContent || "Item";
    const buttons = card.querySelectorAll("button");
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await fetch("/api/command-center-approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action })
      });
      if (!res.ok) throw new Error("Request failed");
      const result = await res.json();
      card.remove();
      const countEl = document.getElementById("approvals-count");
      const remaining = Math.max(0, parseInt(countEl.textContent, 10) - 1);
      countEl.textContent = remaining;
      if (remaining === 0) {
        document.getElementById("approvals-list").innerHTML =
          `<div class="approval-empty">Nothing needs your attention right now.</div>`;
      }
      if (result.manualFollowUpNeeded) {
        showApprovalToast(`Approved "${title}" — this isn't automated yet, follow up with the customer manually.`);
      }
    } catch (e) {
      buttons.forEach((b) => { b.disabled = false; });
      const meta = card.querySelector(".approval-meta");
      if (meta) meta.textContent = "Couldn't update — try again.";
    }
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
  const LIVE_QUICK_ACTIONS = { "Create a Follow-Up": "create-followup", "Generate a Report": "generate-report", "Settings": "open-settings" };

  function renderQuickActions() {
    const container = document.getElementById("quick-actions");
    const canGoLive = location.protocol !== "file:";
    SAMPLE_DATA.quickActions.forEach((a) => {
      const actionKey = LIVE_QUICK_ACTIONS[a.label];
      const isLive = canGoLive && actionKey;
      const btn = el("button", "qa-btn");
      btn.type = "button";
      if (isLive) {
        btn.setAttribute("data-quick-action", actionKey);
      } else {
        btn.disabled = true;
      }
      btn.innerHTML = `
        <span class="qa-icon">${a.icon}</span>
        ${a.label}
        <span class="tooltip">${isLive ? "" : "Not connected yet — display only."}</span>
      `;
      container.appendChild(btn);
    });
  }

  /* ---------------- Live data (Phase 2) ----------------
     Only ever attempted when the page is served over http(s) from Vercel —
     opening index.html directly as a local file (file://) cannot fetch a
     relative /api/ path, so it always falls back to sample data untouched.
     This endpoint has no password of its own — access is gated by Vercel's
     own Deployment Protection on whichever environment this is deployed to.
     Any failure (protection not yet passed, network error, etc.) just
     leaves the dashboard on sample data, silently — nothing here is
     required for the page to work. */
  let liveKpiValues = {};
  function updateLiveKpis(partial) {
    Object.assign(liveKpiValues, partial);
    renderKPIs(liveKpiValues);
  }

  async function loadLiveDataIfAvailable() {
    if (location.protocol === "file:") return;

    try {
      const res = await fetch("/api/command-center-data");
      if (!res.ok) return;
      const data = await res.json();

      updateLiveKpis({
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
    } catch (e) {
      /* silent fallback to sample data — no error UI, nothing required */
    }
  }

  async function loadApprovalsIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-approvals");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.approvals)) return;
      renderApprovals(
        data.approvals.map((a) => ({
          id: a.id,
          title: a.title,
          detail: a.detail,
          requestedAt: a.requested_at,
          actionType: a.action_type
        })),
        true
      );
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  /* ---------------- Follow-ups (real count feeds the KPI card) ---------------- */
  async function loadFollowUpCountIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-followups");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.openCount === "number") {
        updateLiveKpis({ followUpsDue: { value: data.openCount } });
      }
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  /* ---------------- Create-a-Follow-Up modal ---------------- */
  function initFollowUpModal() {
    const modal = document.getElementById("followup-modal");
    const form = document.getElementById("followup-form");
    if (!modal || !form) return;

    const nameInput = document.getElementById("followup-name");
    const noteInput = document.getElementById("followup-note");
    const dueInput = document.getElementById("followup-due");
    const statusEl = document.getElementById("followup-status");
    const submitBtn = document.getElementById("followup-submit");

    function openModal() {
      form.reset();
      statusEl.textContent = "";
      statusEl.className = "modal-status";
      modal.hidden = false;
      nameInput.focus();
    }
    function closeModal() { modal.hidden = true; }

    document.getElementById("followup-modal-close").addEventListener("click", closeModal);
    document.getElementById("followup-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const customerName = nameInput.value.trim();
      if (!customerName) return;
      submitBtn.disabled = true;
      statusEl.textContent = "Saving…";
      statusEl.className = "modal-status";
      try {
        const res = await fetch("/api/command-center-followups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName,
            note: noteInput.value.trim(),
            dueAt: dueInput.value ? new Date(dueInput.value).toISOString() : null
          })
        });
        if (!res.ok) throw new Error("Request failed");
        statusEl.textContent = "Follow-up created.";
        statusEl.className = "modal-status success";
        loadFollowUpCountIfAvailable();
        setTimeout(closeModal, 900);
      } catch (err) {
        statusEl.textContent = "Couldn't save — try again.";
        statusEl.className = "modal-status";
      } finally {
        submitBtn.disabled = false;
      }
    });

    document.getElementById("quick-actions").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-quick-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-quick-action");
      if (action === "create-followup") openModal();
      if (action === "generate-report") generateReport();
      if (action === "open-settings") openSettingsModal();
    });
  }

  /* ---------------- Generate a Report ----------------
     No email/PDF service is defined yet, so this compiles whatever is
     currently on screen (real or sample, honestly labeled) into a plain
     text file the browser downloads directly. No new backend needed. */
  function generateReport() {
    const lines = [];
    lines.push("MYA COMMAND CENTER — SNAPSHOT");
    lines.push(`Elevate Construction · Generated ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET`);
    lines.push("");

    lines.push("KEY NUMBERS:");
    document.querySelectorAll(".kpi-card").forEach((card) => {
      const label = card.querySelector(".kpi-label")?.textContent || "";
      const value = card.querySelector(".kpi-value")?.textContent || "";
      const badge = card.querySelector(".live-badge, .sample-badge")?.textContent || "";
      lines.push(`- ${label}: ${value} (${badge})`);
    });
    lines.push("");

    lines.push("RECENT ACTIVITY:");
    const activityItems = document.querySelectorAll("#activity-list .activity-item");
    if (activityItems.length === 0) {
      lines.push("- Nothing recorded.");
    } else {
      activityItems.forEach((item) => {
        const time = item.querySelector(".activity-time")?.textContent || "";
        const text = item.querySelector(".activity-text")?.textContent || "";
        lines.push(`- [${time}] ${text}`);
      });
    }
    lines.push("");

    lines.push("NEEDS YOUR ATTENTION:");
    const approvalCards = document.querySelectorAll("#approvals-list .approval-card");
    if (approvalCards.length === 0) {
      lines.push("- Nothing pending.");
    } else {
      approvalCards.forEach((c) => {
        const title = c.querySelector(".approval-text strong")?.textContent || "";
        lines.push(`- ${title}`);
      });
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mya-command-center-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------------- Settings ---------------- */
  let currentSettings = null;

  function applySettingsToPage(settings) {
    if (!settings) return;
    if (settings.owner_name) ownerFirstName = settings.owner_name;
    if (settings.footer_tagline) {
      const el = document.getElementById("footer-tagline-text");
      if (el) el.textContent = settings.footer_tagline;
    }
    updateClock();
  }

  async function loadSettingsIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-settings");
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) {
        currentSettings = data.settings;
        applySettingsToPage(currentSettings);
      }
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  function openSettingsModal() {
    const modal = document.getElementById("settings-modal");
    if (!modal) return;
    const nameInput = document.getElementById("settings-owner-name");
    const taglineInput = document.getElementById("settings-tagline");
    const notifyCheckbox = document.getElementById("settings-notify-enabled");
    const phoneInput = document.getElementById("settings-notify-phone");
    const statusEl = document.getElementById("settings-status");

    nameInput.value = currentSettings?.owner_name || ownerFirstName || "";
    taglineInput.value = currentSettings?.footer_tagline || "";
    notifyCheckbox.checked = currentSettings?.notify_enabled !== false;
    phoneInput.value = currentSettings?.notify_phone || "";
    statusEl.textContent = "";
    statusEl.className = "modal-status";

    modal.hidden = false;
    nameInput.focus();
  }

  function initSettingsModal() {
    const modal = document.getElementById("settings-modal");
    const form = document.getElementById("settings-form");
    if (!modal || !form) return;

    function closeModal() { modal.hidden = true; }

    document.getElementById("settings-modal-close").addEventListener("click", closeModal);
    document.getElementById("settings-cancel").addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById("settings-submit");
      const statusEl = document.getElementById("settings-status");
      submitBtn.disabled = true;
      statusEl.textContent = "Saving…";
      statusEl.className = "modal-status";
      try {
        const res = await fetch("/api/command-center-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ownerName: document.getElementById("settings-owner-name").value,
            footerTagline: document.getElementById("settings-tagline").value,
            notifyEnabled: document.getElementById("settings-notify-enabled").checked,
            notifyPhone: document.getElementById("settings-notify-phone").value
          })
        });
        if (!res.ok) throw new Error("Request failed");
        const result = await res.json();
        currentSettings = result.settings;
        applySettingsToPage(currentSettings);
        statusEl.textContent = "Settings saved.";
        statusEl.className = "modal-status success";
        setTimeout(closeModal, 900);
      } catch (err) {
        statusEl.textContent = "Couldn't save — try again.";
        statusEl.className = "modal-status";
      } finally {
        submitBtn.disabled = false;
      }
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
  loadLiveDataIfAvailable();
  loadApprovalsIfAvailable();
  loadFollowUpCountIfAvailable();
  loadSettingsIfAvailable();
  initFollowUpModal();
  initSettingsModal();

  document.getElementById("approvals-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    handleApprovalAction(btn.getAttribute("data-id"), btn.getAttribute("data-action"), btn);
  });
})();
