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

  /* ---------------- Wireframe sphere mesh (decorative, generated once) ----------------
     Procedurally distributes points over a sphere (a standard Fibonacci
     sphere) and projects them to 2D, so the dense "wireframe globe" look
     from the reference doesn't require ~150 hand-authored SVG coordinates.
     Depth (the fake third dimension) only ever affects size/opacity here --
     there is no real 3D rendering, no WebGL, no Three.js; it's plain SVG
     circles and lines, generated once at load and then animated purely
     with CSS (see .mesh-group in styles.css). Runs unconditionally,
     before the auth gate -- this is decorative chrome, not business data. */
  function generateCoreMesh() {
    var svgNS = "http://www.w3.org/2000/svg";
    var group = document.getElementById("mesh-group");
    if (!group) return;
    var cx = 240, cy = 240, R = 150;
    var count = 72;
    var golden = Math.PI * (3 - Math.sqrt(5));
    var points = [];

    for (var i = 0; i < count; i++) {
      var y = 1 - (i / (count - 1)) * 2; // top (-1) to bottom (1)
      var radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      var theta = golden * i;
      var x = Math.cos(theta) * radiusAtY;
      var z = Math.sin(theta) * radiusAtY;
      points.push({ x: x, y: y, z: z });
    }

    // Links first (drawn under the nodes): a light spiral thread (i -> i+1)
    // plus occasional short cross-links, so it reads as a connected mesh
    // rather than a scatter of dots -- capped in number, generated once,
    // never recomputed per frame.
    points.forEach(function (p, i) {
      var next = points[i + 1];
      if (next) group.appendChild(makeMeshLine(p, next, cx, cy, R));
      var cross = points[i + 9];
      if (cross) {
        var dx = (p.x - cross.x) * R, dy = (p.y - cross.y) * R;
        if (Math.sqrt(dx * dx + dy * dy) < 90) group.appendChild(makeMeshLine(p, cross, cx, cy, R));
      }
    });

    points.forEach(function (p) {
      var depth = (p.z + 1) / 2; // 0 = far side, 1 = near side
      var px = cx + p.x * R;
      var py = cy + p.y * R * 0.92; // slight squash -- reads more like the reference's orbital silhouette
      var circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", px.toFixed(1));
      circle.setAttribute("cy", py.toFixed(1));
      circle.setAttribute("r", (0.8 + depth * 1.4).toFixed(2));
      circle.setAttribute("class", "mesh-node");
      circle.style.opacity = (0.15 + depth * 0.55).toFixed(2);
      group.appendChild(circle);
    });

    function makeMeshLine(a, b, cx, cy, R) {
      var line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", (cx + a.x * R).toFixed(1));
      line.setAttribute("y1", (cy + a.y * R * 0.92).toFixed(1));
      line.setAttribute("x2", (cx + b.x * R).toFixed(1));
      line.setAttribute("y2", (cy + b.y * R * 0.92).toFixed(1));
      line.setAttribute("class", "mesh-link");
      return line;
    }
  }
  generateCoreMesh();

  /* ---------------- Entrance animation -- "comes from behind, small, then
     flips/pops into place." Plays once when the shell is first revealed;
     replayable via the dev-only button for review. ---------------- */
  function playCoreIntro() {
    var stage = document.getElementById("mya-core-stage");
    stage.classList.remove("intro-play");
    void stage.offsetWidth; // force reflow so re-adding the class restarts the animation
    stage.classList.add("intro-play");
  }

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

  (function initReplayIntroButton() {
    var btn = document.getElementById("mf-replay-intro-btn");
    if (btn) btn.addEventListener("click", playCoreIntro);
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
    playCoreIntro();
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
