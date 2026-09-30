/**
 * Mya Core — mesh generation, entrance animation, and the state controller.
 *
 * Moved out of app.js (Build 12) unchanged in behavior so the Command
 * Center shell can host the Core in different places (the Home hero, the
 * Mya conversation view, the desktop rail dock, the mobile tab-bar button)
 * without touching its internals. There is exactly ONE Core element in the
 * page; MyaShell moves it between slots rather than cloning it, so every
 * state change is always reflected wherever she currently is.
 *
 * REAL vs DEV states. Driven by real signals (chat.js, voice.js,
 * presence.js): idle, listening, thinking, waiting (a request in flight
 * with no answer yet after a few seconds), speaking (only while her audio
 * is actually playing), completed (a reply just arrived, or she just
 * finished speaking), awaiting-approval and blocked (resting states from
 * real approvals / Executive Mya being unreachable), and error (a failed
 * request). The rest (memory-retrieval, tool-use, working, delegating,
 * alert) have no backend signal yet and are only reachable from the
 * dev-only preview (Systems view, ?dev=1), which marks itself as dev.
 */
(function (global) {
  "use strict";

  /* ---------------- Wireframe sphere mesh (decorative, generated once) ----------------
     Procedurally distributes points over a sphere (a standard Fibonacci
     sphere) and projects them to 2D. Depth only ever affects size/opacity;
     plain SVG circles and lines, generated once at load and animated purely
     with CSS (see .mesh-group in core.css). Decorative chrome, not data. */
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
    // plus occasional short cross-links, so it reads as a connected mesh.
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
      var py = cy + p.y * R * 0.92;
      var circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", px.toFixed(1));
      circle.setAttribute("cy", py.toFixed(1));
      circle.setAttribute("r", (0.8 + depth * 1.4).toFixed(2));
      circle.setAttribute("class", "mesh-node");
      circle.style.opacity = (0.15 + depth * 0.55).toFixed(2);
      // Randomized negative delay so the particles' twinkle doesn't pulse
      // in lockstep.
      circle.style.animationDelay = (-Math.random() * 3.4).toFixed(2) + "s";
      group.appendChild(circle);
    });

    function makeMeshLine(a, b, cx, cy, R) {
      var line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", (cx + a.x * R).toFixed(1));
      line.setAttribute("y1", (cy + a.y * R * 0.92).toFixed(1));
      line.setAttribute("x2", (cx + b.x * R).toFixed(1));
      line.setAttribute("y2", (cy + b.y * R * 0.92).toFixed(1));
      line.setAttribute("class", "mesh-link");
      line.style.animationDelay = (-Math.random() * 4.2).toFixed(2) + "s";
      return line;
    }
  }
  generateCoreMesh();

  /* ---------------- Entrance animation ---------------- */
  function playCoreIntro() {
    var stage = document.getElementById("mya-core-stage");
    stage.classList.remove("intro-play");
    void stage.offsetWidth; // force reflow so re-adding the class restarts the animation
    stage.classList.add("intro-play");
  }

  /* ---------------- Mya Core state controller ---------------- */
  var coreEl = document.getElementById("mya-core");
  var idleTimer = null;

  // Human-facing wording for each state, shown in the status strip and
  // under the Core. Keys are the Core's own data-state values.
  var STATE_LABELS = {
    "idle": "Ready",
    "listening": "Listening",
    "thinking": "Thinking",
    "speaking": "Speaking",
    "waiting": "Still working",
    "blocked": "Unavailable",
    "memory-retrieval": "Recalling",
    "tool-use": "Using a tool",
    "working": "Working",
    "delegating": "Delegating",
    "awaiting-approval": "Awaiting approval",
    "completed": "Done",
    "alert": "Alert",
    "error": "Didn't answer"
  };

  function setCoreState(stateName, opts) {
    opts = opts || {};
    coreEl.setAttribute("data-state", stateName);
    document.documentElement.setAttribute("data-mya-state", stateName);
    var label = (STATE_LABELS[stateName] || stateName) + (opts.dev ? " (dev preview)" : "");
    var labelEls = document.querySelectorAll("[data-core-state-label]");
    for (var i = 0; i < labelEls.length; i++) labelEls[i].textContent = label;
    coreEl.setAttribute("aria-label", "Mya's core, currently " + label.toLowerCase());
    MyaEvents.emit("core.state", { state: stateName, dev: Boolean(opts.dev) });
  }

  function getCoreState() {
    return coreEl.getAttribute("data-state");
  }

  // Where a temporary state settles back to once its hold period ends.
  // Plain idle by default; chat.js points it at the mic state once the voice
  // pipeline initializes, so "she stopped talking" settles to "listening"
  // instead of "idle" whenever the mic is on.
  var settleFn = function () { setCoreState(restingState()); };

  // What the Core shows when nothing is happening. MyaPresence sets it to
  // "awaiting-approval" while real approvals are pending, so the Core itself
  // tells you she's waiting on you, and to "blocked" while Executive Mya
  // can't be reached. While the Windows Agent reports a real computer task
  // (Watch Mya), she rests in "working" or "waiting" for as long as it runs.
  var RESTING = ["idle", "awaiting-approval", "blocked", "working", "waiting"];
  var resting = "idle";
  function restingState() { return resting; }
  function setResting(stateName) {
    var next = RESTING.indexOf(stateName) !== -1 ? stateName : "idle";
    if (next === resting) return;
    var current = getCoreState();
    resting = next;
    if (RESTING.indexOf(current) !== -1) setCoreState(resting);
  }

  function settleCore() { settleFn(); }
  function setSettle(fn) { settleFn = fn; }

  // Real transitions auto-return after a short settle period.
  function setCoreStateTemporary(stateName, holdMs) {
    clearTimeout(idleTimer);
    setCoreState(stateName);
    idleTimer = setTimeout(function () { settleCore(); }, holdMs);
  }

  function clearIdleTimer() { clearTimeout(idleTimer); }

  // Real event -> state wiring.
  MyaEvents.on("mya.thinking", function () { clearTimeout(idleTimer); setCoreState("thinking"); });
  // Still no answer after a few seconds: say so instead of spinning forever.
  MyaEvents.on("mya.waiting", function () { if (getCoreState() === "thinking") setCoreState("waiting"); });
  // A reply arrived. With audio, chat.js holds "speaking" for exactly as
  // long as she's audible; without it she was never speaking, so the Core
  // shows a brief "completed" instead.
  MyaEvents.on("mya.responding", function (d) {
    if (d && d.audio) { clearTimeout(idleTimer); setCoreState("speaking"); }
    else setCoreStateTemporary("completed", 1600);
  });
  MyaEvents.on("mya.idle", function () { clearTimeout(idleTimer); setCoreState(restingState()); });
  // A failed request flashes the Core's contained error state, then settles.
  MyaEvents.on("mya.outcome", function (o) { if (o && o.ok === false) setCoreStateTemporary("error", 1800); });

  /* ---------------- Dev-only state preview row ----------------
     Not part of the product experience; only rendered when the page is
     opened with ?dev=1 (see the Systems view). Every click emits with
     dev: true and never touches the network. */
  var DEV_PREVIEW_STATES = [
    "idle", "listening", "thinking", "waiting", "working", "speaking",
    "completed", "awaiting-approval", "blocked", "error",
    "memory-retrieval", "tool-use", "delegating", "alert"
  ];

  function renderDevStateRow(row) {
    if (!row) return;
    row.textContent = "";
    DEV_PREVIEW_STATES.forEach(function (stateName) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = stateName;
      btn.addEventListener("click", function () {
        clearTimeout(idleTimer);
        setCoreState(stateName, { dev: true });
        MyaEvents.emit("dev.state-preview", { state: stateName, dev: true });
      });
      row.appendChild(btn);
    });
  }

  global.MyaCore = {
    el: coreEl,
    setState: setCoreState,
    getState: getCoreState,
    setTemporary: setCoreStateTemporary,
    settle: settleCore,
    setSettle: setSettle,
    restingState: restingState,
    setResting: setResting,
    clearIdleTimer: clearIdleTimer,
    playIntro: playCoreIntro,
    renderDevStateRow: renderDevStateRow,
    STATE_LABELS: STATE_LABELS
  };
})(window);
