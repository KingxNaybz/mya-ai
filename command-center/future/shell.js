/**
 * MyaShell — navigation, Core placement, and the global status strip.
 *
 * Routing is hash-based (#/home, #/mya, ...) so it works on Vercel's plain
 * static hosting with no rewrites, and so the service worker only ever has
 * one document to cache.
 *
 * Core placement: there is exactly one Mya Core. On Home she's the hero; in
 * the Mya view she heads the conversation; everywhere else she docks at the
 * foot of the desktop rail, or inside the center tab-bar button on mobile.
 * She is never absent from the screen.
 */
(function (global) {
  "use strict";

  var ROUTES = ["home", "mya", "projects", "approvals", "memory", "files", "operations", "devices", "systems"];
  var TITLES = {
    home: "Home", mya: "Mya", projects: "Projects", approvals: "Approvals", memory: "Memory",
    files: "Files", operations: "Operations", devices: "Devices", systems: "Systems"
  };
  var ATLANTA_TZ = "America/New_York";
  var MOBILE_QUERY = window.matchMedia("(max-width: 899px)");

  var currentRoute = null;
  var ownerName = "";

  function $(id) { return document.getElementById(id); }

  /* ---------------- Core placement ---------------- */
  function coreSlotFor(route) {
    if (route === "home") return $("core-slot-home");
    if (route === "mya") return $("core-slot-mya");
    return MOBILE_QUERY.matches ? $("core-slot-tab") : $("core-slot-rail");
  }

  function placeCore() {
    var perspective = document.querySelector(".mya-core-perspective");
    var slot = coreSlotFor(currentRoute);
    if (!perspective || !slot || perspective.parentNode === slot) return false;
    slot.appendChild(perspective);
    var slots = document.querySelectorAll(".core-slot");
    for (var i = 0; i < slots.length; i++) slots[i].classList.toggle("has-core", slots[i] === slot);
    return true;
  }

  // She travels: when the one Core moves to another slot, it flies from
  // where it was to where it lands (FLIP: measure, move, animate back from
  // the old spot). Same element throughout; nothing is cloned.
  var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");
  var flyTimer = null;
  function coreRect() {
    var p = document.querySelector(".mya-core-perspective");
    if (!p || !p.offsetParent) return null;
    var r = p.getBoundingClientRect();
    return r.width ? r : null;
  }
  function flyCore(from) {
    var p = document.querySelector(".mya-core-perspective");
    var to = coreRect();
    if (!from || !to || !p.animate || REDUCED_MOTION.matches) return;
    var dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    var dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    var sc = from.width / to.width;
    document.documentElement.classList.add("core-flying");
    clearTimeout(flyTimer);
    p.animate([
      { transform: "translate(" + dx + "px, " + dy + "px) scale(" + sc + ")", opacity: 0.85 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 }
    ], { duration: 560, easing: "cubic-bezier(0.22, 0.9, 0.24, 1)" });
    flyTimer = setTimeout(function () { document.documentElement.classList.remove("core-flying"); }, 600);
  }

  /* ---------------- Routing ---------------- */
  function applyRoute(userInitiated) {
    var from = currentRoute ? coreRect() : null;
    var route = MyaLib.parseRoute(location.hash, ROUTES, "home");
    var changed = route !== currentRoute;
    currentRoute = route;

    var views = document.querySelectorAll("[data-view]");
    for (var i = 0; i < views.length; i++) views[i].hidden = views[i].getAttribute("data-view") !== route;

    var links = document.querySelectorAll("[data-route]");
    for (var j = 0; j < links.length; j++) {
      var active = links[j].getAttribute("data-route") === route;
      links[j].classList.toggle("active", active);
      if (active) links[j].setAttribute("aria-current", "page"); else links[j].removeAttribute("aria-current");
    }
    var moreBtn = $("more-btn");
    if (moreBtn) moreBtn.classList.toggle("active", ["memory", "files", "operations", "devices", "systems"].indexOf(route) !== -1);

    document.documentElement.setAttribute("data-route", route);
    document.title = (route === "home" ? "Mya — Command Center" : TITLES[route] + " · Mya");
    var moved = placeCore();
    closeMore();

    if (changed && userInitiated) {
      window.scrollTo(0, 0);
      $("stage").scrollTop = 0;
      if (route === "mya" && !MOBILE_QUERY.matches) $("mf-command-input").focus({ preventScroll: true });
      else $("stage").focus({ preventScroll: true });
    }
    if (moved) flyCore(from);
  }

  /* ---------------- More sheet (mobile) ---------------- */
  function openMore() {
    $("more-sheet").hidden = false;
    $("more-backdrop").hidden = false;
    $("more-btn").setAttribute("aria-expanded", "true");
    requestAnimationFrame(function () { document.documentElement.classList.add("sheet-open"); });
    var first = $("more-sheet").querySelector("a");
    if (first) first.focus();
  }
  function closeMore() {
    if (!$("more-sheet") || $("more-sheet").hidden) return;
    document.documentElement.classList.remove("sheet-open");
    $("more-sheet").hidden = true;
    $("more-backdrop").hidden = true;
    $("more-btn").setAttribute("aria-expanded", "false");
  }

  /* ---------------- Greeting + clock ---------------- */
  function tick() {
    var now = new Date();
    var hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: ATLANTA_TZ, hour: "numeric", hour12: false }).format(now), 10) % 24;
    var greet = "Good " + MyaLib.partOfDay(hour) + (ownerName ? ", " + ownerName : "") + ".";
    var g = $("home-greeting");
    if (g.textContent !== greet) g.textContent = greet;
    $("home-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: ATLANTA_TZ, weekday: "long", month: "long", day: "numeric" }).format(now);
    $("strip-clock").textContent = new Intl.DateTimeFormat("en-US", { timeZone: ATLANTA_TZ, hour: "numeric", minute: "2-digit" }).format(now) + " ET";
  }

  /* ---------------- Status strip ---------------- */
  function renderStrip() {
    var worst = MyaLib.worstFreshness(MyaData.allFreshness());
    var dataEl = $("strip-data");
    dataEl.className = "strip-item fresh-" + worst.state;
    dataEl.querySelector(".strip-text").textContent =
      worst.state === "live" ? "All data live"
      : worst.state === "stale" ? "Some data stale"
      : worst.state === "loading" ? "Loading data"
      : "Some data not connected";
    dataEl.title = "Worst freshness across all Command Center data sources — details in Systems.";
    // A system a live check just found down outranks freshness: it's the
    // one thing on the strip you'd want to act on.
    var sys = MyaData.get("systems");
    var down = MyaLib.systemsDown(sys && sys.data && sys.data.systems, MyaData.freshness("systems"));
    if (down.length) {
      dataEl.className = "strip-item fresh-down";
      dataEl.querySelector(".strip-text").textContent = down.length === 1 ? down[0] + " is down" : down.length + " systems down";
      dataEl.title = "A live check found " + down.join(", ") + " down — details in Systems.";
    }

    var approvals = MyaData.get("approvals");
    var af = MyaData.freshness("approvals");
    var count = af.state === "live" || af.state === "stale"
      ? (approvals.data && Array.isArray(approvals.data.approvals) ? approvals.data.approvals.length : null)
      : null;
    var label = count == null ? "–" : count >= 10 ? "10+" : String(count);
    $("strip-approvals-count").textContent = label;
    $("strip-approvals").classList.toggle("has-items", Boolean(count));
    var badges = document.querySelectorAll("[data-approvals-badge]");
    for (var i = 0; i < badges.length; i++) {
      badges[i].hidden = !count;
      badges[i].textContent = label;
    }

    var last = MyaData.lastSyncAt();
    $("strip-sync").textContent = last ? "Synced " + MyaLib.formatRelative(last) : "Not synced";
  }

  function onMicChanged(s) {
    var el = $("strip-mic");
    el.classList.toggle("on", Boolean(s.micEnabled));
    el.querySelector(".strip-text").textContent = !s.supported ? "No voice input" : s.micEnabled ? "Wake word on" : "Wake word off";
    el.title = 'Hands-free: listening for the wake word "Mya"';
  }

  /* ---------------- init ---------------- */
  function init(settings) {
    ownerName = (settings && settings.owner_name) || "";

    window.addEventListener("hashchange", function () { applyRoute(true); });
    MOBILE_QUERY.addEventListener("change", placeCore);
    applyRoute(false);

    $("more-btn").addEventListener("click", function () { if ($("more-sheet").hidden) openMore(); else closeMore(); });
    $("more-backdrop").addEventListener("click", closeMore);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMore();
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
      // ⌘K / Ctrl+K from anywhere, or "/" when not typing: talk to Mya
      // right where you are. Home focuses its quick-ask, a module opens its
      // "Ask Mya about this" bar, and anything else goes to the conversation.
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        if (currentRoute === "home" && !$("home-ask-input").disabled) { $("home-ask-input").focus(); return; }
        if (MyaAskAbout.open(currentRoute)) return;
        if (currentRoute !== "mya") location.hash = "#/mya";
        setTimeout(function () { $("mf-command-input").focus(); }, 0);
      }
    });

    $("refresh-btn").addEventListener("click", function () {
      var btn = $("refresh-btn");
      btn.classList.add("spinning");
      MyaData.refreshAll().then(function () { btn.classList.remove("spinning"); });
    });

    // Home quick-ask and suggestion chips use the exact same chat path.
    $("home-ask-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("home-ask-input");
      var msg = input.value.trim();
      if (!msg) return;
      input.value = "";
      // Her answer shows on Home itself (the last-exchange line), so no toast.
      MyaChat.send(msg, { inline: true });
    });
    $("chat-suggestions").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-suggest]");
      if (chip) MyaChat.send(chip.textContent);
    });
    MyaEvents.on("chat.line", function (line) {
      var el = $("home-last-exchange");
      el.hidden = false;
      el.textContent = (line.role === "user" ? "You: " : "Mya: ") + line.text;
      el.classList.toggle("from-mya", line.role !== "user");
    });

    // Dev-only Core state preview (Systems view), never shown by default.
    if (/[?&]dev=1\b/.test(location.search)) {
      $("dev-card").hidden = false;
      MyaCore.renderDevStateRow($("mf-dev-states-row"));
      $("mf-replay-intro-btn").addEventListener("click", MyaCore.playIntro);
      $("mf-simulate-voice-btn").addEventListener("click", function () { MyaVoice.simulate("turn"); });
      Array.prototype.forEach.call(document.querySelectorAll("[data-simulate]"), function (b) {
        b.addEventListener("click", function () { MyaVoice.simulate(b.getAttribute("data-simulate")); });
      });
    }

    MyaEvents.on("data.changed", renderStrip);
    MyaEvents.on("mic.changed", onMicChanged);
    setInterval(renderStrip, 15000);
    tick();
    setInterval(tick, 15000);
    renderStrip();
  }

  global.MyaShell = { init: init, ROUTES: ROUTES, placeCore: placeCore, closeMore: closeMore };
})(window);
