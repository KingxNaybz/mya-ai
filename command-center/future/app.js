/**
 * Mya Command Center — bootstrap + authentication gate.
 *
 * Auth is unchanged from Build 12 (and the classic dashboard): same
 * /api/command-center-settings endpoint, same request shapes, same single
 * HttpOnly session cookie, same probe-before-render ordering, and the same
 * fail-closed rule -- if the server can't confirm a session (401, error, or
 * unreachable) the login overlay is shown and nothing else is fetched or
 * rendered. This file introduces no second authentication mechanism.
 *
 * Load order (index.html): lib -> mya-events -> core -> data -> chat ->
 * voice -> presence -> ask-about -> views -> shell -> app.
 */
(function () {
  "use strict";

  // Explicit, absolute path to navigate to after login/logout -- NOT a bare
  // location.reload(). Vercel canonicalizes ".../index.html" to ".../" on
  // first load; navigating to this exact file path every time removes any
  // ambiguity about which URL the post-login probe runs on (Build 12 fix).
  var FUTURE_INTERFACE_PATH = "/command-center/future/index.html";
  var shellStarted = false;

  function showLoginOverlay(message) {
    document.getElementById("mf-shell").hidden = true;
    var overlay = document.getElementById("mf-login-overlay");
    var passwordInput = document.getElementById("mf-login-password");
    var errEl = document.getElementById("mf-login-error");
    overlay.hidden = false;
    errEl.hidden = !message;
    errEl.textContent = message || "";
    passwordInput.value = "";
    passwordInput.focus();
    if (shellStarted) MyaData.stop();
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
          // Navigate (not reload) so the page-load auth probe re-runs now
          // that the session cookie is set.
          location.replace(FUTURE_INTERFACE_PATH);
        })
        .catch(function () {
          errEl.textContent = "Couldn't reach the server — check your connection and try again.";
          errEl.hidden = false;
          submitBtn.disabled = false;
        });
    });
  }

  function initLogoutControls() {
    var buttons = document.querySelectorAll("[data-logout]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (e) {
        e.currentTarget.disabled = true;
        fetch("/api/command-center-settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ logout: true }),
        })
          .catch(function () { /* best-effort -- navigate back regardless */ })
          .then(function () { location.replace(FUTURE_INTERFACE_PATH); });
      });
    }
  }

  // App-shell caching only (see sw.js) -- never API data. Registered after
  // a confirmed session so a logged-out visitor never installs anything.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    var secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (!secure) return;
    navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function (err) {
      console.warn("Service worker registration failed (app still works online):", err);
    });
  }

  function initShell(settingsData) {
    var settings = (settingsData && settingsData.settings) || null;
    document.getElementById("mf-shell").hidden = false;
    shellStarted = true;
    MyaCore.setState("idle");
    MyaShell.init(settings);
    MyaViews.init();
    MyaPresence.init();
    MyaAskAbout.init();
    MyaChat.init();
    MyaVoice.init();
    initLogoutControls();
    MyaCore.playIntro();
    MyaData.start();
    registerServiceWorker();
  }

  // Any 401 after the shell is up (data poll, chat, approval) = session
  // ended: fail closed back to the login overlay.
  MyaEvents.on("auth.expired", function () {
    showLoginOverlay("Your session ended — sign in again to continue.");
  });

  /* ---------------- Auth gate -- probe first, never render or fetch
     anything else until that resolves. ---------------- */
  function initAuthGate() {
    fetch("/api/command-center-settings", { credentials: "same-origin" })
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
        // Fail closed -- an unreachable server is treated as "not
        // authenticated", never as a reason to show the shell.
        showLoginOverlay(navigator.onLine ? "" : "You're offline — Mya's Command Center needs a connection to sign in.");
      });
  }

  initLoginOverlay();
  initAuthGate();
})();
