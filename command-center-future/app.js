/**
 * Mya Future Interface — Phase 1 (visual prototype)
 *
 * This file intentionally duplicates only BEHAVIOR from the existing
 * command-center/app.js auth flow (same endpoints, same request shapes,
 * same probe-before-render ordering) -- never introduces a second
 * authentication mechanism. It shares the exact same session cookie as
 * the existing dashboard: logging in here also authenticates
 * /command-center/, and vice versa, because both pages call the same
 * /api/command-center-settings and rely on the one HttpOnly cookie the
 * browser already holds for this origin.
 *
 * REAL vs DEV state note: only three Mya Core states are driven by a real
 * signal in this milestone -- idle, thinking (a chat request is in
 * flight), and speaking (a reply just arrived). Every other state
 * (listening, memory-retrieval, tool-use, working, delegating,
 * awaiting-approval, completed, alert, error) has no real signal to drive
 * it yet in this shell -- listening depends on the voice/wake-word
 * pipeline (ported in a later milestone), the rest depend on backend
 * signal work that doesn't exist yet. Those are only reachable through the
 * "dev preview" button row, which sets a `dev: true` flag on the emitted
 * event so this is never confused with real activity.
 */
(function () {
  "use strict";

  /* ---------------- Mya Core state controller ---------------- */
  var coreEl = document.getElementById("mya-core");
  var stateLabelEl = document.getElementById("mf-state-label");
  var idleTimer = null;

  function setCoreState(stateName, opts) {
    opts = opts || {};
    coreEl.setAttribute("data-state", stateName);
    stateLabelEl.textContent = stateName + (opts.dev ? " (dev preview)" : "");
  }

  // Real transitions auto-return to idle after a short settle period, same
  // idea as the existing orb's speaking animation not running forever.
  function setCoreStateTemporary(stateName, holdMs) {
    clearTimeout(idleTimer);
    setCoreState(stateName);
    idleTimer = setTimeout(function () { setCoreState("idle"); }, holdMs);
  }

  // Real event -> state wiring. Only these three emissions ever happen
  // outside the dev-preview row in this milestone.
  MyaEvents.on("mya.thinking", function () { clearTimeout(idleTimer); setCoreState("thinking"); });
  MyaEvents.on("mya.responding", function () { setCoreStateTemporary("speaking", 2200); });
  MyaEvents.on("mya.idle", function () { clearTimeout(idleTimer); setCoreState("idle"); });

  /* ---------------- Dev-only state preview row ----------------
     Not part of the product experience. Lets a reviewer see all twelve
     states without needing the (not-yet-built) signals that would
     normally drive most of them. Every click here emits its event with
     dev: true and never touches the network. */
  var DEV_PREVIEW_STATES = [
    "idle", "listening", "thinking", "speaking", "memory-retrieval",
    "tool-use", "working", "delegating", "awaiting-approval",
    "completed", "alert", "error"
  ];
  (function initDevStateRow() {
    var row = document.getElementById("mf-dev-states-row");
    DEV_PREVIEW_STATES.forEach(function (stateName) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = stateName;
      btn.addEventListener("click", function () {
        clearTimeout(idleTimer);
        setCoreState(stateName, { dev: true });
        MyaEvents.emit("dev.state-preview", { state: stateName, dev: true });
      });
      row.appendChild(btn);
    });
  })();

  /* ---------------- Login overlay (identical behavior to the existing
     dashboard's overlay -- same endpoint, same request shape) ---------------- */
  function showLoginOverlay() {
    document.getElementById("mf-shell").hidden = true;
    var overlay = document.getElementById("mf-login-overlay");
    var passwordInput = document.getElementById("mf-login-password");
    var errEl = document.getElementById("mf-login-error");
    overlay.hidden = false;
    errEl.hidden = true;
    errEl.textContent = "";
    passwordInput.value = "";
    passwordInput.focus();
  }

  function initLoginOverlay() {
    var form = document.getElementById("mf-login-form");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var passwordInput = document.getElementById("mf-login-password");
      var errEl = document.getElementById("mf-login-error");
      var submitBtn = form.querySelector("button[type=submit]");
      var password = passwordInput.value;
      submitBtn.disabled = true;
      fetch("/api/command-center-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: true, password: password }),
      })
        .then(function (res) {
          passwordInput.value = "";
          if (!res.ok) {
            return res.json().catch(function () { return {}; }).then(function (data) {
              errEl.textContent = data.error || "Incorrect password — try again.";
              errEl.hidden = false;
              submitBtn.disabled = false;
            });
          }
          // Same reasoning as the existing dashboard: reload so the
          // page-load auth probe re-runs now that the session cookie is
          // set, rather than trying to hand-roll a post-login init path.
          location.reload();
        })
        .catch(function () {
          errEl.textContent = "Couldn't reach the server — check your connection and try again.";
          errEl.hidden = false;
          submitBtn.disabled = false;
        });
    });
  }

  function initLogoutControl() {
    var btn = document.getElementById("mf-logout-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      fetch("/api/command-center-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logout: true }),
      })
        .catch(function () { /* best-effort -- reload regardless */ })
        .then(function () { location.reload(); });
    });
  }

  /* ---------------- Real command bar -- genuine authenticated chat ----------------
     Talks to the exact same /api/command-center-ask-mya endpoint the
     existing dashboard uses. This is what makes thinking/speaking real
     signals instead of decoration. */
  function initCommandBar() {
    var form = document.getElementById("mf-command-form");
    var input = document.getElementById("mf-command-input");
    var log = document.getElementById("mf-command-log");
    var sendBtn = document.getElementById("mf-command-send");
    var history = [];

    function addLine(text, role) {
      var line = document.createElement("div");
      line.className = "mf-log-line " + role;
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var message = input.value.trim();
      if (!message) return;
      input.value = "";
      sendBtn.disabled = true;
      addLine(message, "user");
      history.push({ role: "user", content: message });

      MyaEvents.emit("mya.thinking", { dev: false });

      fetch("/api/command-center-ask-mya", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, history: history.slice(-20) }),
      })
        .then(function (res) {
          if (res.status === 401) {
            MyaEvents.emit("mya.idle", { dev: false });
            showLoginOverlay();
            return null;
          }
          return res.json().then(function (data) { return { ok: res.ok, data: data }; });
        })
        .then(function (result) {
          if (!result) return; // handled above (401)
          if (!result.ok) {
            addLine(result.data.error || "Something went wrong — try again.", "mya");
            MyaEvents.emit("mya.idle", { dev: false });
            return;
          }
          var reply = result.data.reply || "(no reply)";
          addLine(reply, "mya");
          history.push({ role: "assistant", content: reply });
          MyaEvents.emit("mya.responding", { dev: false });
        })
        .catch(function () {
          addLine("Couldn't reach Mya — try again.", "mya");
          MyaEvents.emit("mya.idle", { dev: false });
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    });
  }

  /* ---------------- Reveal the shell once a real session is confirmed ---------------- */
  function initShell(settingsData) {
    var ownerName = (settingsData && settingsData.settings && settingsData.settings.owner_name) || "";
    document.getElementById("mf-greeting").textContent = ownerName
      ? "Hello, " + ownerName + "."
      : "Hello.";
    document.getElementById("mf-shell").hidden = false;
    setCoreState("idle");
    initCommandBar();
    initLogoutControl();
  }

  /* ---------------- Auth gate -- identical ordering to the existing
     dashboard: probe first, never render or fetch anything else until
     that resolves. ---------------- */
  function initAuthGate() {
    fetch("/api/command-center-settings")
      .then(function (res) {
        if (!res.ok) {
          showLoginOverlay();
          return null;
        }
        return res.json();
      })
      .then(function (data) {
        if (data === null) return; // not authenticated, overlay already shown
        document.getElementById("mf-login-overlay").hidden = true;
        initShell(data);
      })
      .catch(function () {
        // Fail closed -- treat an unreachable server the same as "not
        // authenticated" rather than guessing and showing the shell.
        showLoginOverlay();
      });
  }

  initLoginOverlay();
  initAuthGate();
})();
