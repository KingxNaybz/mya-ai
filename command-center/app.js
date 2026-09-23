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

  // Caller-supplied text (names/emails/etc. said out loud on real calls)
  // ends up in innerHTML for the Caller Directory below — escape it so a
  // caller can never inject markup into the dashboard.
  function escapeHtmlText(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
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
    const panel = content.closest(".panel, .modal-card");
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
      card.setAttribute("data-kpi", key);
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
  function renderSchedule(items, isLive) {
    const container = document.getElementById("schedule-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.todaysSchedule;
    if (isLive && list.length === 0) {
      container.innerHTML = '<div class="timeline-item"><div class="timeline-name">Nothing scheduled for today.</div></div>';
    } else {
      list.forEach((s) => {
        const item = el("div", "timeline-item");
        item.innerHTML = `
          <div class="timeline-when">${s.time}</div>
          <div class="timeline-name">${s.label}</div>
        `;
        container.appendChild(item);
      });
    }
    setLiveBadge("schedule-list", Boolean(isLive));
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
  function renderWorkingNow(items, isLive) {
    const container = document.getElementById("working-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.workingNow;
    if (isLive && list.length === 0) {
      container.appendChild(el("li", null, "No actions taken yet."));
    } else {
      list.forEach((text) => {
        container.appendChild(el("li", null, text));
      });
    }
    setLiveBadge("working-list", Boolean(isLive));
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
  function renderProjects(items, isLive) {
    const container = document.getElementById("projects-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.projectsNeedingAttention;

    if (isLive && list.length === 0) {
      container.innerHTML = `<div class="approval-empty">No projects need attention right now.</div>`;
    } else {
      list.forEach((p) => {
        const row = el("div", "list-row");
        if (isLive) {
          row.innerHTML = `
            <div class="list-row-main">
              <strong>${p.name}</strong>
              <span>${p.issue || "—"}</span>
            </div>
            <div class="list-row-side">${p.status || ""}</div>
          `;
        } else {
          row.innerHTML = `
            <div class="list-row-main">
              <strong>${p.name}</strong>
              <span>${p.issue}</span>
            </div>
            <div class="list-row-side">${p.days} day${p.days === 1 ? "" : "s"}</div>
          `;
        }
        container.appendChild(row);
      });
    }
    setLiveBadge("projects-list", Boolean(isLive));
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

  /* ---------------- Contractors & Sub-Contractors ---------------- */
  function renderContractors(items, isLive) {
    const container = document.getElementById("contractors-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.contractors;

    if (isLive && list.length === 0) {
      container.innerHTML = `<div class="approval-empty">No contractors added yet.</div>`;
    } else {
      list.forEach((c) => {
        const row = el("div", "list-row");
        row.innerHTML = `
          <div class="list-row-main">
            <strong>${c.name} <span class="approval-type-tag">${c.category || "—"}</span></strong>
            <span>${c.notes || "—"}${c.rate ? " · " + c.rate : ""}</span>
          </div>
          <div class="list-row-side">${c.phone || "—"}</div>
          ${isLive && c.id ? `<button type="button" class="list-row-remove" data-contractor-id="${c.id}" title="Remove">✕</button>` : ""}
        `;
        container.appendChild(row);
      });
    }
    setLiveBadge("contractors-list", Boolean(isLive));

    const addBtn = document.getElementById("add-contractor-btn");
    if (addBtn) addBtn.disabled = !isLive;
  }

  /* ---------------- Mya's Memory ---------------- */
  function renderMemoryFacts(items, isLive) {
    const container = document.getElementById("memory-facts-list");
    container.innerHTML = "";
    const list = items || SAMPLE_DATA.memoryFacts;

    if (isLive && list.length === 0) {
      container.innerHTML = `<div class="approval-empty">Nothing remembered yet — tell Mya "remember that..." to teach her something.</div>`;
    } else {
      list.forEach((f) => {
        const row = el("div", "list-row");
        row.innerHTML = `
          <div class="list-row-main">
            <span>${f.fact}</span>
          </div>
          <div class="list-row-side">${f.agoText || ""}</div>
          ${isLive && f.id ? `<button type="button" class="list-row-remove" data-memory-id="${f.id}" title="Forget">✕</button>` : ""}
        `;
        container.appendChild(row);
      });
    }
    setLiveBadge("memory-facts-list", Boolean(isLive));
  }

  /* ---------------- Connected services ---------------- */
  function renderServices(items, isLive) {
    const container = document.getElementById("services-list");
    container.innerHTML = "";
    (items || SAMPLE_DATA.connectedServices).forEach((s) => {
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
    setLiveBadge("services-list", Boolean(isLive));
  }

  /* ---------------- Caller Directory ---------------- */
  const CALLER_CATEGORY_LABELS = {
    lead: "Leads",
    existing_client: "Existing Clients",
    vendor: "Vendors",
    contractor: "Contractors",
    subcontractor: "Subcontractors",
    general_contractor: "General Contractors",
    bill_collector: "Bill Collectors",
    job_applicant: "Job Applicants",
    wrong_number_or_spam: "Wrong Number / Spam",
    uncategorized: "Uncategorized",
  };

  let callerDirectoryData = [];
  let callerDirectoryActiveTab = "all";

  function callerDirectoryLabel(category) {
    return CALLER_CATEGORY_LABELS[category] || "Uncategorized";
  }

  function renderCallerDirectoryTabs() {
    const tabsEl = document.getElementById("caller-directory-tabs");
    if (!tabsEl) return;
    const present = new Set(callerDirectoryData.map((c) => c.category || "uncategorized"));
    const categories = Object.keys(CALLER_CATEGORY_LABELS).filter((c) => present.has(c));
    tabsEl.innerHTML = "";

    const makeTab = (key, label, count) => {
      const btn = el("button", "directory-tab" + (callerDirectoryActiveTab === key ? " active" : ""));
      btn.type = "button";
      btn.textContent = count === null ? label : `${label} (${count})`;
      btn.addEventListener("click", () => {
        callerDirectoryActiveTab = key;
        renderCallerDirectoryTabs();
        renderCallerDirectoryRows();
      });
      tabsEl.appendChild(btn);
    };

    makeTab("all", "All", callerDirectoryData.length);
    categories.forEach((c) => {
      const count = callerDirectoryData.filter((row) => (row.category || "uncategorized") === c).length;
      makeTab(c, callerDirectoryLabel(c), count);
    });
  }

  function renderCallerDirectoryRows() {
    const container = document.getElementById("caller-directory-list");
    if (!container) return;
    container.innerHTML = "";

    const rows = callerDirectoryActiveTab === "all"
      ? callerDirectoryData
      : callerDirectoryData.filter((row) => (row.category || "uncategorized") === callerDirectoryActiveTab);

    if (rows.length === 0) {
      container.innerHTML = '<div class="directory-empty">No calls classified yet — this fills in automatically as calls come in.</div>';
      return;
    }

    rows.forEach((row) => {
      const item = el("div", "directory-row");
      const canReclassify = Boolean(row.phone || row.name);
      const selectId = `dir-cat-${Math.random().toString(36).slice(2)}`;
      const options = Object.keys(CALLER_CATEGORY_LABELS)
        .map((key) => `<option value="${key}"${key === (row.category || "uncategorized") ? " selected" : ""}>${escapeHtmlText(CALLER_CATEGORY_LABELS[key])}</option>`)
        .join("");
      item.innerHTML = `
        <div class="directory-cell"><strong>${escapeHtmlText(row.name || "Unknown")}</strong>${row.company ? `<span>${escapeHtmlText(row.company)}</span>` : ""}</div>
        <div class="directory-cell${row.phone ? "" : " directory-muted"}">${escapeHtmlText(row.phone || "—")}</div>
        <div class="directory-cell${row.email ? "" : " directory-muted"}">${escapeHtmlText(row.email || "—")}</div>
        <div class="directory-cell${row.website ? "" : " directory-muted"}">${escapeHtmlText(row.website || "—")}</div>
        <div class="directory-cell">
          <select class="directory-category-select${row.flagForBlock ? " flagged" : ""}" id="${selectId}" ${canReclassify ? "" : "disabled"} title="${canReclassify ? "Move to a different category" : "Missing name/phone — can't identify this caller to reclassify"}">
            ${options}
          </select>
        </div>
      `;
      const select = item.querySelector("select");
      if (canReclassify) {
        select.addEventListener("change", () => reclassifyCallerRow(row, select.value, select));
      }
      container.appendChild(item);
    });
  }

  // Lets the owner correct a misclassified caller straight from the
  // dropdown, without needing to ask Mya — uses the same reclassify_caller
  // skill Mya uses when told in chat/voice, via a direct (non-Claude) call
  // so a plain dropdown change doesn't cost an AI request.
  async function reclassifyCallerRow(row, newCategory, selectEl) {
    const previousCategory = row.category;
    selectEl.disabled = true;
    try {
      const res = await fetch("/api/command-center-ask-mya", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directTool: "reclassify_caller",
          input: { query: row.phone || row.name, category: newCategory },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.result || data.result.error || data.result.matches) {
        alert(
          (data.result && data.result.error) ||
          (data.result && data.result.matches ? "More than one caller matched — ask Mya to reclassify by name instead so you can pick." : "Couldn't reclassify that caller — try again.")
        );
        renderCallerDirectoryRows(); // revert the dropdown to the real current value
        return;
      }
      row.category = newCategory;
      row.flagForBlock = newCategory === "bill_collector";
      renderCallerDirectoryTabs();
      renderCallerDirectoryRows();
    } catch (e) {
      alert("Couldn't reach the dashboard to reclassify that caller — check your connection and try again.");
      renderCallerDirectoryRows();
    } finally {
      selectEl.disabled = false;
    }
  }

  function renderCallerDirectory(items, isLive) {
    callerDirectoryData = Array.isArray(items) ? items : [];
    callerDirectoryActiveTab = "all";
    renderCallerDirectoryTabs();
    renderCallerDirectoryRows();
    setLiveBadge("caller-directory-list", Boolean(isLive));
  }

  // Builds a real multi-tab .xlsx (one sheet per category) client-side via
  // the SheetJS library loaded in index.html — no backend involved, so this
  // always exports whatever's currently loaded in the dashboard.
  function downloadCallerDirectoryXlsx() {
    if (typeof XLSX === "undefined") {
      alert("Spreadsheet export isn't available right now — try refreshing the page.");
      return;
    }
    if (callerDirectoryData.length === 0) {
      alert("No classified callers yet — nothing to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const usedSheetNames = new Set();

    const toSheetRows = (rows) =>
      rows.map((r) => ({
        Name: r.name || "",
        Phone: r.phone || "",
        Email: r.email || "",
        Website: r.website || "",
        Company: r.company || "",
        Category: callerDirectoryLabel(r.category),
        "Flagged For Block": r.flagForBlock ? "Yes" : "",
        Notes: r.reasoning || "",
        "Call Date": r.createdAt ? new Date(r.createdAt).toLocaleString("en-US") : "",
      }));

    const allSheet = XLSX.utils.json_to_sheet(toSheetRows(callerDirectoryData));
    XLSX.utils.book_append_sheet(wb, allSheet, "All Contacts");
    usedSheetNames.add("All Contacts");

    Object.keys(CALLER_CATEGORY_LABELS).forEach((category) => {
      const rows = callerDirectoryData.filter((r) => (r.category || "uncategorized") === category);
      if (rows.length === 0) return;
      // Excel sheet names: max 31 chars, no \ / ? * [ ] :
      let name = CALLER_CATEGORY_LABELS[category].replace(/[\\/?*[\]:]/g, "").slice(0, 31);
      while (usedSheetNames.has(name)) name = `${name.slice(0, 28)}_2`;
      usedSheetNames.add(name);
      const sheet = XLSX.utils.json_to_sheet(toSheetRows(rows));
      XLSX.utils.book_append_sheet(wb, sheet, name);
    });

    XLSX.writeFile(wb, "Elevate-Construction-Caller-Directory.xlsx");
  }

  // Lives in its own modal (opened from the "Company Contacts" nav item)
  // rather than taking up permanent space on the dashboard itself.
  function openCompanyContactsModal() {
    const modal = document.getElementById("company-contacts-modal");
    if (modal) modal.hidden = false;
  }

  function closeCompanyContactsModal() {
    const modal = document.getElementById("company-contacts-modal");
    if (modal) modal.hidden = true;
  }

  function initCompanyContactsModal() {
    const modal = document.getElementById("company-contacts-modal");
    const navItem = document.getElementById("nav-company-contacts");
    const closeBtn = document.getElementById("company-contacts-modal-close");
    if (!modal) return;

    if (navItem) {
      navItem.addEventListener("click", (e) => {
        e.preventDefault();
        openCompanyContactsModal();
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", closeCompanyContactsModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeCompanyContactsModal(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeCompanyContactsModal();
    });
  }

  const callerDirectoryDownloadBtn = document.getElementById("caller-directory-download-btn");
  if (callerDirectoryDownloadBtn) {
    callerDirectoryDownloadBtn.addEventListener("click", downloadCallerDirectoryXlsx);
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

      if (Array.isArray(data.schedule)) {
        renderSchedule(data.schedule, true);
      }

      if (Array.isArray(data.workingNow)) {
        renderWorkingNow(data.workingNow, true);
      }

      if (Array.isArray(data.services)) {
        renderServices(data.services, true);
      }

      if (Array.isArray(data.callerDirectory)) {
        renderCallerDirectory(data.callerDirectory, true);
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

  /* ---------------- Contractors (live) ---------------- */
  async function loadContractorsIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-contractors");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.contractors)) return;
      renderContractors(
        data.contractors.map((c) => ({
          id: c.id,
          category: c.category,
          name: c.name,
          phone: c.phone,
          rate: c.pricing_rate,
          notes: c.notes,
          addedInCrm: c.added_in_crm
        })),
        true
      );
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  /* ---------------- Memory facts (live) ---------------- */
  async function loadMemoryFactsIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-memory");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.facts)) return;
      renderMemoryFacts(
        data.facts.map((f) => ({ id: f.id, fact: f.fact, agoText: formatRelative(f.created_at) })),
        true
      );
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  /* ---------------- Projects (live — Project Brain) ---------------- */
  async function loadProjectsIfAvailable() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("/api/command-center-projects");
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.projects)) return;
      renderProjects(
        data.projects.map((p) => ({
          name: p.client_name ? `${p.project_name} — ${p.client_name}` : p.project_name,
          issue: p.next_action || p.outstanding_decisions || "No action set",
          status: p.status
        })),
        true
      );
    } catch (e) {
      /* silent fallback to sample data */
    }
  }

  // This is still one single dashboard page, not separate pages per nav
  // item — clicking "Leads," "Approvals," etc. jumps you to that section
  // right here and briefly highlights it, rather than doing nothing (which
  // is what every one of these used to do). "Settings" opens the same real
  // settings modal the Quick Actions button already does.
  function flashPanel(el) {
    if (!el) return;
    const panel = el.closest(".panel, .kpi-card") || el;
    panel.classList.add("panel-flash");
    setTimeout(() => panel.classList.remove("panel-flash"), 1200);
  }

  function initSidenavJumpLinks() {
    const jumpTargets = {
      "nav-command-center": null, // scrolls to top, handled separately below
      "nav-calls": "activity-list",
      "nav-leads": "leads-list",
      "nav-followups": '.kpi-card[data-kpi="followUpsDue"]',
      "nav-projects": "projects-list",
      "nav-approvals": "approvals-list",
      "nav-memory": "memory-facts-list",
    };

    Object.entries(jumpTargets).forEach(([navId, targetSelector]) => {
      const navEl = document.getElementById(navId);
      if (!navEl) return;
      navEl.addEventListener("click", (e) => {
        e.preventDefault();
        if (!targetSelector) {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        const target = targetSelector.startsWith(".")
          ? document.querySelector(targetSelector)
          : document.getElementById(targetSelector);
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        flashPanel(target);
      });
    });

    const settingsNav = document.getElementById("nav-settings");
    if (settingsNav) {
      settingsNav.addEventListener("click", (e) => {
        e.preventDefault();
        openSettingsModal();
      });
    }
  }

  function initMemoryPanel() {
    document.getElementById("memory-facts-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-memory-id]");
      if (!btn) return;
      const id = btn.getAttribute("data-memory-id");
      const row = btn.closest(".list-row");
      const factText = row?.querySelector(".list-row-main span")?.textContent || "this";
      if (!window.confirm(`Forget "${factText.trim()}"?`)) return;

      btn.disabled = true;
      try {
        const res = await fetch(`/api/command-center-memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Request failed");
        row.remove();
      } catch (err) {
        btn.disabled = false;
        window.alert("Couldn't forget that — try again.");
      }
    });
  }

  /* ---------------- Add / remove a contractor ---------------- */
  function initContractorModal() {
    const modal = document.getElementById("contractor-modal");
    const form = document.getElementById("contractor-form");
    const addBtn = document.getElementById("add-contractor-btn");
    const closeBtn = document.getElementById("contractor-modal-close");
    const cancelBtn = document.getElementById("contractor-cancel");
    const submitBtn = document.getElementById("contractor-submit");
    const statusEl = document.getElementById("contractor-status");

    function openModal() {
      form.reset();
      statusEl.textContent = "";
      statusEl.className = "modal-status";
      modal.hidden = false;
    }
    function closeModal() {
      modal.hidden = true;
    }

    addBtn.addEventListener("click", () => {
      if (!addBtn.disabled) openModal();
    });
    closeBtn.addEventListener("click", closeModal);
    cancelBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      statusEl.textContent = "Saving…";
      statusEl.className = "modal-status";
      try {
        const res = await fetch("/api/command-center-contractors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category: document.getElementById("contractor-category").value.trim(),
            name: document.getElementById("contractor-name").value.trim(),
            phone: document.getElementById("contractor-phone").value.trim(),
            pricingRate: document.getElementById("contractor-rate").value.trim(),
            notes: document.getElementById("contractor-notes").value.trim(),
            addedInCrm: document.getElementById("contractor-added-crm").checked
          })
        });
        if (!res.ok) throw new Error("Request failed");
        statusEl.textContent = "Contractor added.";
        statusEl.className = "modal-status success";
        loadContractorsIfAvailable();
        setTimeout(closeModal, 900);
      } catch (err) {
        statusEl.textContent = "Couldn't save — try again.";
        statusEl.className = "modal-status";
      } finally {
        submitBtn.disabled = false;
      }
    });

    document.getElementById("contractors-list").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-contractor-id]");
      if (!btn) return;
      const id = btn.getAttribute("data-contractor-id");
      const row = btn.closest(".list-row");
      const name = row?.querySelector(".list-row-main strong")?.textContent || "this contractor";
      if (!window.confirm(`Remove ${name.trim()} from the list?`)) return;

      btn.disabled = true;
      try {
        const res = await fetch(`/api/command-center-contractors?id=${encodeURIComponent(id)}`, {
          method: "DELETE"
        });
        if (!res.ok) throw new Error("Request failed");
        row.remove();
      } catch (err) {
        btn.disabled = false;
        window.alert("Couldn't remove that contractor — try again.");
      }
    });
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

  /* ---------------- Ask Mya ---------------- */
  function initAskMya() {
    const input = document.getElementById("ask-mya-input");
    const sendBtn = document.getElementById("ask-mya-send");
    const log = document.getElementById("ask-mya-log");

    function addMessage(text, role) {
      log.hidden = false;
      const msg = el("div", `ask-msg ask-msg-${role}`, escapeHtml(text));
      log.appendChild(msg);
      log.scrollTop = log.scrollHeight;
      return msg;
    }

    function escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }

    // Resets on page reload (a fresh conversation each time you open the
    // dashboard) — without this, every message is a brand-new request with
    // no memory of what was just said, so a direct follow-up answer to
    // something Mya just asked has nothing to go on.
    let conversationHistory = [];

    async function send() {
      const message = input.value.trim();
      if (!message) return;

      if (location.protocol === "file:") {
        addMessage(message, "user");
        addMessage("Ask Mya only works on the live dashboard, not when opened as a local file.", "mya error");
        input.value = "";
        return;
      }

      addMessage(message, "user");
      input.value = "";
      input.disabled = true;
      sendBtn.disabled = true;
      const pending = addMessage("Thinking…", "mya pending");

      try {
        const res = await fetch("/api/command-center-ask-mya", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, voice: voiceEnabled, history: conversationHistory }),
        });
        const data = await res.json().catch(() => ({}));

        pending.remove();

        if (!res.ok) {
          addMessage(data.message || data.error || "Something went wrong — try again.", "mya error");
          return;
        }

        const reply = data.reply || "Done.";
        addMessage(reply, "mya");
        playReplyAudio(data.audioBase64);

        conversationHistory.push({ role: "user", content: message });
        conversationHistory.push({ role: "assistant", content: reply });
        if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);

        const toolsUsed = Array.isArray(data.toolsUsed) ? data.toolsUsed : [];
        if (toolsUsed.includes("add_contractor") || toolsUsed.includes("remove_contractor")) {
          loadContractorsIfAvailable();
        }
        if (toolsUsed.includes("resolve_approval")) {
          loadApprovalsIfAvailable();
        }
        if (toolsUsed.includes("create_followup")) {
          loadFollowUpCountIfAvailable();
        }
        if (toolsUsed.includes("remember_fact")) {
          loadMemoryFactsIfAvailable();
        }
        if (toolsUsed.includes("create_project") || toolsUsed.includes("update_project")) {
          loadProjectsIfAvailable();
          loadLiveDataIfAvailable(); // update_project can set nextActionDue, changing Today's Schedule
        }
        if (toolsUsed.includes("create_appointment")) {
          loadLiveDataIfAvailable(); // refreshes Today's Schedule and Mya Working Now
        }
        if (toolsUsed.includes("open_contact_directory")) {
          openCompanyContactsModal(); // opens the Company Contacts spreadsheet view
        }
        if (toolsUsed.includes("undo_last_action")) {
          // Undo can reverse any reversible skill — refresh everything it could have touched.
          loadContractorsIfAvailable();
          loadApprovalsIfAvailable();
          loadFollowUpCountIfAvailable();
          loadMemoryFactsIfAvailable();
          loadProjectsIfAvailable();
          loadLiveDataIfAvailable();
        }
      } catch (err) {
        pending.remove();
        addMessage("Couldn't reach Mya — check your connection and try again.", "mya error");
      } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      }
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });

    /* ---- Voice replies (ElevenLabs, matches the phone system's voice) ----
       Backend only returns audio when we ask for it (voice:true) and both
       ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are set server-side — if
       either is missing, audioBase64 is just null and nothing plays. */
    const voiceToggleBtn = document.getElementById("ask-mya-voice-toggle");
    const micBtn = document.getElementById("ask-mya-mic");
    const voiceStatusEl = document.getElementById("ask-mya-voice-status");
    let voiceEnabled = localStorage.getItem("mya-voice-enabled") !== "off";
    let currentAudio = null;

    function setVoiceStatus(text) {
      if (!text) {
        voiceStatusEl.hidden = true;
        voiceStatusEl.textContent = "";
        return;
      }
      voiceStatusEl.hidden = false;
      voiceStatusEl.textContent = text;
    }

    function applyVoiceToggleUI() {
      voiceToggleBtn.textContent = voiceEnabled ? "🔊" : "🔇";
      voiceToggleBtn.classList.toggle("is-muted", !voiceEnabled);
      voiceToggleBtn.title = voiceEnabled
        ? "Mya speaks her replies out loud (click to mute)"
        : "Mya's voice is muted (click to unmute)";
    }
    applyVoiceToggleUI();

    voiceToggleBtn.addEventListener("click", () => {
      voiceEnabled = !voiceEnabled;
      localStorage.setItem("mya-voice-enabled", voiceEnabled ? "on" : "off");
      applyVoiceToggleUI();
      if (!voiceEnabled && currentAudio) currentAudio.pause();
    });

    const myaOrb = document.getElementById("mya-orb");

    function stopSpeakingAnimation() {
      if (myaOrb) myaOrb.classList.remove("is-speaking");
      pausedForPlayback = false;
      if (!micEnabled) return;
      // She just finished replying — stay in "listening for your answer"
      // mode for a few seconds instead of requiring the wake word again,
      // so answering a question she just asked works like a real
      // back-and-forth conversation, not a fresh command each time.
      enterAwakeMode();
      startRecognition();
    }

    async function playReplyAudio(audioBase64) {
      if (!audioBase64 || !voiceEnabled) return;
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.src = "";
        }
        currentAudio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
        if (myaOrb) myaOrb.classList.add("is-speaking");
        currentAudio.addEventListener("ended", stopSpeakingAnimation);
        currentAudio.addEventListener("error", () => {
          console.error("Mya voice playback error:", currentAudio && currentAudio.error);
          stopSpeakingAnimation();
        });
        // recognition.stop() is asynchronous — the mic isn't actually off
        // until onend fires. Wait for that confirmation before playing,
        // otherwise the still-live mic can hear the first few words of her
        // own reply and mistake them for a new thing you said.
        await pauseWakeListening();
        currentAudio.play().catch((err) => {
          console.error("Mya voice play() failed:", err);
          stopSpeakingAnimation();
        });
      } catch (e) {
        stopSpeakingAnimation();
      }
    }

    /* ---- Always-listen wake word ("Mya") ----
       Uses the browser's free built-in speech recognition — no new
       dependency, but it only runs while this tab is open and focused, and
       quality varies by browser (best in Chrome/Edge). Recognition is
       paused while Mya's own voice is playing so she can't hear herself
       and re-trigger. */
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognition = null;
    let micEnabled = localStorage.getItem("mya-mic-enabled") === "on";
    let awake = false;
    let awakeTimeout = null;
    let pausedForPlayback = false;
    let intentionalStop = false;

    function setMicUI() {
      if (!SpeechRecognitionCtor) {
        micBtn.disabled = true;
        micBtn.title = "Voice input isn't supported in this browser — try Chrome or Edge.";
        if (myaOrb) myaOrb.title = "Voice input isn't supported in this browser — try Chrome or Edge.";
        return;
      }
      micBtn.classList.toggle("is-on", micEnabled);
      micBtn.classList.toggle("is-listening", micEnabled && !awake);
      micBtn.title = micEnabled ? 'Always listening for "Mya" — click to turn off' : 'Click to always listen for "Mya"';
      if (myaOrb) {
        myaOrb.classList.toggle("is-listening", micEnabled && !awake);
        myaOrb.title = micEnabled ? 'Always listening for "Mya" — click to turn off' : 'Click, then say "Mya" to talk to her';
      }
    }

    // Returns a promise that resolves only once the mic has actually
    // confirmed it stopped (recognition.onend fired) — not just when
    // .stop() was called, since that's async in every browser. Wraps the
    // existing onend handler (rather than replacing it) so its normal
    // side effects — resetting intentionalStop, scheduling a restart —
    // still happen exactly as before.
    function pauseWakeListening() {
      pausedForPlayback = true;
      if (!recognition) return Promise.resolve();
      return new Promise((resolve) => {
        intentionalStop = true;
        const originalOnEnd = recognition.onend;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        recognition.onend = (event) => {
          if (typeof originalOnEnd === "function") originalOnEnd(event);
          finish();
        };
        // Safety net: if the recognizer was already idle, some browsers
        // never fire onend for a stop() call — never let that hang block
        // her from speaking at all.
        setTimeout(finish, 500);
        try {
          recognition.stop();
        } catch (e) {
          finish();
        }
      });
    }

    // How long to keep listening for a follow-up without requiring the
    // wake word again. 7s proved too short for a real back-and-forth —
    // reading a multi-point rundown and then framing a follow-up question
    // easily takes longer than that.
    const AWAKE_TIMEOUT_MS = 20000;

    function resetAwakeTimer() {
      clearTimeout(awakeTimeout);
      awakeTimeout = setTimeout(() => {
        awake = false;
        setMicUI();
        setVoiceStatus('Listening for "Mya"…');
      }, AWAKE_TIMEOUT_MS);
    }

    function enterAwakeMode() {
      awake = true;
      setMicUI();
      setVoiceStatus("Yes? I'm listening…");
      resetAwakeTimer();
    }

    function wakeAndSend(text) {
      awake = false;
      clearTimeout(awakeTimeout);
      setMicUI();
      input.value = text;
      send();
    }

    function startRecognition() {
      if (!SpeechRecognitionCtor || pausedForPlayback || !micEnabled) return;
      recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      // Chrome's speech recognition often mishears "Mya" (not a common
      // dictionary word) as a near-homophone — match those too, since a
      // wake word that only matches its exact spelling barely works.
      const WAKE_WORD = /\b(mya|maya|mia|nia)\b/i;

      recognition.onresult = (event) => {
        const result = event.results[event.results.length - 1];
        const transcript = result[0].transcript.trim();
        if (!transcript) return;

        if (!awake) {
          if (!WAKE_WORD.test(transcript)) return;
          // Flip into awake mode the instant the wake word shows up, even
          // in an interim (not-yet-final) result — waiting for Chrome to
          // finalize the segment risks losing the next few words if the
          // speaker pauses right after saying "Mya" and Chrome restarts
          // the recognizer in that gap.
          enterAwakeMode();
          if (!result.isFinal) return;
        } else {
          // Already in conversation mode and hearing something — extend
          // the window instead of letting it expire mid-thought.
          resetAwakeTimer();
        }

        if (!result.isFinal) return; // don't act on a still-changing transcript

        const after = transcript.replace(new RegExp(`^.*${WAKE_WORD.source}[,:]?\\s*`, "i"), "").trim();
        if (after) wakeAndSend(after);
        // else: this segment was just the wake word alone — already awake
        // and waiting, the actual request will arrive as the next result.
      };

      recognition.onerror = (event) => {
        console.error("Mya mic error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          micEnabled = false;
          localStorage.setItem("mya-mic-enabled", "off");
          setMicUI();
          setVoiceStatus('Mic permission denied — click the icon left of the address bar, allow microphone access, then click 🎙 again.');
        } else if (event.error === "audio-capture") {
          micEnabled = false;
          localStorage.setItem("mya-mic-enabled", "off");
          setMicUI();
          setVoiceStatus("No microphone found — check that one is connected and try again.");
        } else if (event.error === "network") {
          setVoiceStatus("Having trouble reaching the speech recognition service — check your internet connection.");
        }
        /* other errors (no-speech, aborted): normal during continuous listening — onend will retry silently */
      };

      recognition.onend = () => {
        if (intentionalStop) {
          intentionalStop = false;
          return;
        }
        if (micEnabled && !pausedForPlayback) {
          setTimeout(startRecognition, 300);
        }
      };

      try {
        recognition.start();
        setVoiceStatus(awake ? "Yes? I'm listening…" : 'Listening for "Mya"…');
      } catch (e) {
        if (e && e.name === "InvalidStateError") return; // already running — harmless
        console.error("Mya mic failed to start:", e);
        micEnabled = false;
        localStorage.setItem("mya-mic-enabled", "off");
        setMicUI();
        setVoiceStatus("Couldn't start the microphone — check Chrome's site permissions (click the icon left of the address bar) and try again.");
      }
    }

    function toggleMicListening() {
      if (!SpeechRecognitionCtor) return;
      micEnabled = !micEnabled;
      localStorage.setItem("mya-mic-enabled", micEnabled ? "on" : "off");
      setMicUI();
      if (micEnabled) {
        startRecognition();
      } else {
        awake = false;
        clearTimeout(awakeTimeout);
        intentionalStop = true;
        if (recognition) {
          try { recognition.stop(); } catch (e) { /* ignore */ }
        }
        setVoiceStatus("");
      }
    }

    micBtn.addEventListener("click", toggleMicListening);

    // The orb is a second way to reach the exact same always-listen mic —
    // same state, same wake word, not a separate feature to keep in sync.
    if (myaOrb) {
      myaOrb.addEventListener("click", toggleMicListening);
      myaOrb.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleMicListening();
        }
      });
    }

    setMicUI();
    if (micEnabled) startRecognition();

    /* Proactive check-ins: Mya notices something without being asked
       (a stale approval, an overdue follow-up) and mentions it here as
       soon as the dashboard loads — a deterministic check, not an LLM
       call, so it's instant and never hallucinates. */
    async function checkProactiveAlerts() {
      if (location.protocol === "file:") return;
      try {
        const res = await fetch("/api/command-center-projects?type=alerts");
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data.alerts)) return;
        data.alerts.forEach((a) => addMessage(a.message, "mya proactive"));
      } catch (e) {
        /* silent — proactive check-ins are a nice-to-have, never block the page */
      }
    }
    checkProactiveAlerts();
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
  renderCallerDirectory();
  renderDevices();
  renderContractors();
  renderMemoryFacts();
  renderQuickActions();
  loadLiveDataIfAvailable();
  loadApprovalsIfAvailable();
  loadFollowUpCountIfAvailable();
  loadContractorsIfAvailable();
  loadMemoryFactsIfAvailable();
  loadProjectsIfAvailable();
  loadSettingsIfAvailable();
  initFollowUpModal();
  initSettingsModal();
  initContractorModal();
  initMemoryPanel();
  initCompanyContactsModal();
  initSidenavJumpLinks();
  initAskMya();

  document.getElementById("approvals-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    handleApprovalAction(btn.getAttribute("data-id"), btn.getAttribute("data-action"), btn);
  });
})();
