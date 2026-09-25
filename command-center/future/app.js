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
 * REAL vs DEV state note: four Mya Core states are driven by a real signal
 * now -- idle, listening (the wake-word mic is on and not currently busy),
 * thinking (a chat request is in flight), and speaking (a reply just
 * arrived). Every other state (memory-retrieval, tool-use, working,
 * delegating, awaiting-approval, completed, alert, error) has no real
 * signal to drive it yet in this shell -- those depend on backend signal
 * work that doesn't exist yet, and are only reachable through the "dev
 * preview" button row, which sets a `dev: true` flag on the emitted event
 * so this is never confused with real activity.
 */
(function () {
  "use strict";

  // Explicit, absolute path to navigate back to after login/logout --
  // deliberately NOT a bare location.reload(). Vercel's static hosting
  // canonicalizes a request for ".../index.html" (redirecting it to
  // ".../", the directory form) on the first load. location.reload()
  // re-requests whatever the browser now considers "here" -- which, after
  // that redirect, may be the canonicalized directory URL rather than the
  // literal file path -- and that second form is a different request the
  // static host resolves independently. Navigating to this exact,
  // hard-coded file path every time removes that ambiguity entirely: both
  // post-login and post-logout always land on the one URL already
  // confirmed to serve this interface, never on whatever the address bar
  // happened to normalize to.
  var FUTURE_INTERFACE_PATH = "/command-center/future/index.html";

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
      // Randomized negative delay so the 72 particles' twinkle (see
      // .mesh-node in styles.css) don't all pulse in lockstep -- a single
      // shared phase would make the whole mesh flash together like one
      // object instead of reading as independent, asynchronous activity.
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

  // Where a temporary state settles back to once its hold period ends.
  // Plain idle by default; reassigned (not redeclared -- same closure) once
  // the mic pipeline initializes below, so "she stopped talking" settles
  // back to "listening" instead of "idle" whenever the mic is on.
  var settleCore = function () { setCoreState("idle"); };

  // Real transitions auto-return to idle after a short settle period, same
  // idea as the existing orb's speaking animation not running forever.
  function setCoreStateTemporary(stateName, holdMs) {
    clearTimeout(idleTimer);
    setCoreState(stateName);
    idleTimer = setTimeout(function () { settleCore(); }, holdMs);
  }

  // Real event -> state wiring. Only these three emissions ever happen
  // outside the dev-preview row in this milestone. "listening" is also
  // real (see the mic pipeline in initCommandBar below) but is driven
  // directly by setCoreState/settleCore rather than through MyaEvents,
  // since it's a standing condition (the mic is on and idle) rather than
  // a one-off occurrence to broadcast.
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
          // Navigate (not reload -- see FUTURE_INTERFACE_PATH above) so the
          // page-load auth probe re-runs now that the session cookie is
          // set, rather than trying to hand-roll a post-login init path.
          // location.replace() so this doesn't add a back-button entry,
          // matching reload()'s history behavior.
          location.replace(FUTURE_INTERFACE_PATH);
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
        .catch(function () { /* best-effort -- navigate back regardless */ })
        .then(function () { location.replace(FUTURE_INTERFACE_PATH); });
    });
  }

  /* ---------------- Real command bar -- genuine authenticated chat ----------------
     Talks to the exact same /api/command-center-ask-mya endpoint the
     existing dashboard uses. This is what makes thinking/speaking real
     signals instead of decoration.

     Voice: requests audio the exact same way the existing dashboard does
     (voice: true in the request body; the backend only returns
     audioBase64 when ELEVENLABS_API_KEY/ELEVENLABS_VOICE_ID are configured
     server-side and voice was requested -- otherwise it's just null and
     nothing plays, same as before). Shares the existing dashboard's
     mya-voice-enabled localStorage key so muting on one page carries to
     the other -- same origin, same preference, not a new setting.

     Voice input: the existing dashboard's always-listening "Mya" wake-word
     pipeline (browser SpeechRecognition, no new dependency), ported here
     behavior-for-behavior -- same wake word, same 45s conversation window,
     same 3s quiet-period buffering so a mid-sentence pause doesn't cut you
     off, same mic-pause-during-her-own-playback so she can't hear and
     re-trigger herself. Shares the existing dashboard's mya-mic-enabled
     localStorage key, same as voice output shares mya-voice-enabled. */
  function initCommandBar() {
    var form = document.getElementById("mf-command-form");
    var input = document.getElementById("mf-command-input");
    var log = document.getElementById("mf-command-log");
    var sendBtn = document.getElementById("mf-command-send");
    var voiceToggleBtn = document.getElementById("mf-voice-toggle");
    var micBtn = document.getElementById("mf-mic-toggle");
    var voiceStatusEl = document.getElementById("mf-voice-status");
    var history = [];
    var voiceEnabled = localStorage.getItem("mya-voice-enabled") !== "off";
    var currentAudio = null;

    function addLine(text, role) {
      var line = document.createElement("div");
      line.className = "mf-log-line " + role;
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

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

    voiceToggleBtn.addEventListener("click", function () {
      voiceEnabled = !voiceEnabled;
      localStorage.setItem("mya-voice-enabled", voiceEnabled ? "on" : "off");
      applyVoiceToggleUI();
      if (!voiceEnabled && currentAudio) currentAudio.pause();
    });

    /* ---- Always-listen wake word ("Mya") -- ported from the existing
       dashboard's SpeechRecognition subsystem. Declared here (rather than
       as a separate top-level function) so it shares performSend() and the
       voice-output state below without threading extra parameters through. */
    var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var recognition = null;
    var micEnabled = localStorage.getItem("mya-mic-enabled") === "on";
    var awake = false;
    var awakeTimeout = null;
    var pausedForPlayback = false;
    var intentionalStop = false;
    var pendingSpeechBuffer = "";
    var pendingSendTimer = null;
    var recognitionGeneration = 0; // see startRecognition()'s onend for why

    function setMicUI() {
      if (!SpeechRecognitionCtor) {
        micBtn.disabled = true;
        micBtn.title = "Voice input isn't supported in this browser — try Chrome or Edge.";
        return;
      }
      micBtn.classList.toggle("is-on", micEnabled);
      micBtn.classList.toggle("is-listening", micEnabled && !awake);
      micBtn.title = micEnabled ? 'Always listening for "Mya" — click to turn off' : 'Click to always listen for "Mya"';
    }

    // Only flips the Core to "listening" if it's currently idle -- never
    // steals the display away from a "thinking"/"speaking" transition that
    // might be mid-flight (e.g. the mic being turned on right as a reply
    // is arriving).
    function showListeningIfIdle() {
      if (coreEl.getAttribute("data-state") === "idle") setCoreState("listening");
    }

    // Returns a promise that resolves only once the mic has actually
    // confirmed it stopped (recognition.onend fired) -- .stop() itself is
    // async in every browser. Wraps the existing onend handler (rather
    // than replacing it) so its normal side effects still run.
    function pauseWakeListening() {
      pausedForPlayback = true;
      if (!recognition) return Promise.resolve();
      return new Promise(function (resolve) {
        intentionalStop = true;
        var originalOnEnd = recognition.onend;
        var settled = false;
        var finish = function () {
          if (settled) return;
          settled = true;
          resolve();
        };
        recognition.onend = function (event) {
          if (typeof originalOnEnd === "function") originalOnEnd(event);
          finish();
        };
        // Safety net: some browsers never fire onend for a stop() call on
        // an already-idle recognizer -- never let that hang block her from
        // speaking at all.
        setTimeout(finish, 500);
        try {
          recognition.stop();
        } catch (e) {
          finish();
        }
      });
    }

    // How long to keep listening for a follow-up without requiring the
    // wake word again -- long enough for a real back-and-forth, not just
    // one exchange.
    var AWAKE_TIMEOUT_MS = 45000;

    function resetAwakeTimer() {
      clearTimeout(awakeTimeout);
      awakeTimeout = setTimeout(function () {
        awake = false;
        clearTimeout(pendingSendTimer);
        pendingSendTimer = null;
        pendingSpeechBuffer = "";
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
      performSend(text);
    }

    // Chrome marks a segment "final" after any pause, including a normal
    // mid-sentence breath, not just the end of a thought -- sending the
    // instant a segment finalizes cuts people off mid-sentence. Buffer
    // finalized text and wait for a real quiet period before sending; any
    // further speech extends the wait instead of firing early.
    var FINAL_RESULT_QUIET_PERIOD_MS = 3000;

    function queueSpeechForSend(text) {
      pendingSpeechBuffer = pendingSpeechBuffer ? pendingSpeechBuffer + " " + text : text;
      extendPendingSend();
    }

    function extendPendingSend() {
      clearTimeout(pendingSendTimer);
      pendingSendTimer = setTimeout(function () {
        var toSend = pendingSpeechBuffer;
        pendingSpeechBuffer = "";
        pendingSendTimer = null;
        if (toSend) wakeAndSend(toSend);
      }, FINAL_RESULT_QUIET_PERIOD_MS);
    }

    function startRecognition() {
      if (!SpeechRecognitionCtor || pausedForPlayback || !micEnabled) return;
      var myGeneration = ++recognitionGeneration;
      recognition = new SpeechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      // Chrome's speech recognition often mishears "Mya" as a near
      // homophone -- match those too.
      var WAKE_WORD = /\b(mya|maya|mia|nia)\b/i;

      recognition.onresult = function (event) {
        var result = event.results[event.results.length - 1];
        var transcript = result[0].transcript.trim();
        if (!transcript) return;

        if (!awake) {
          if (!WAKE_WORD.test(transcript)) return;
          // Flip into awake mode on an interim result already -- waiting
          // for Chrome to finalize the segment risks losing the next few
          // words if the speaker pauses right after saying "Mya".
          enterAwakeMode();
          if (!result.isFinal) return;
        } else {
          resetAwakeTimer();
          if (pendingSendTimer) extendPendingSend();
        }

        if (!result.isFinal) return; // don't act on a still-changing transcript

        var after = transcript.replace(new RegExp("^.*" + WAKE_WORD.source + "[,:]?\\s*", "i"), "").trim();
        if (after) queueSpeechForSend(after);
        // else: this segment was just the wake word alone -- already awake
        // and waiting, the actual request arrives as the next result.
      };

      recognition.onerror = function (event) {
        console.error("Mya mic error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          teardownMic(true);
          setVoiceStatus('Mic permission denied — click the icon left of the address bar, allow microphone access, then click 🎙 again.');
        } else if (event.error === "audio-capture") {
          teardownMic(true);
          setVoiceStatus("No microphone found — check that one is connected and try again.");
        } else if (event.error === "network") {
          setVoiceStatus("Having trouble reaching the speech recognition service — check your internet connection.");
        }
        /* other errors (no-speech, aborted): normal during continuous listening -- onend will retry silently */
      };

      recognition.onend = function () {
        // A newer recognition instance has already taken over -- this is a
        // stale, late-arriving event from an instance nobody's using
        // anymore; touching the shared flags here would only interfere.
        if (myGeneration !== recognitionGeneration) return;
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
        if (e && e.name === "InvalidStateError") return; // already running -- harmless
        console.error("Mya mic failed to start:", e);
        teardownMic(true);
        setVoiceStatus("Couldn't start the microphone — check Chrome's site permissions (click the icon left of the address bar) and try again.");
      }
    }

    // Fully stops the current recognition instance and clears all mic
    // timers/flags. persistOff also writes the "off" preference (a real
    // user- or error-driven turn-off); a session-expiry teardown passes
    // false so the preference survives and the mic resumes after the next
    // login without the user having to re-enable it.
    function teardownMic(persistOff) {
      micEnabled = false;
      if (persistOff) localStorage.setItem("mya-mic-enabled", "off");
      awake = false;
      clearTimeout(awakeTimeout);
      clearTimeout(pendingSendTimer);
      pendingSendTimer = null;
      pendingSpeechBuffer = "";
      intentionalStop = true;
      if (recognition) {
        try { recognition.stop(); } catch (e) { /* ignore */ }
      }
      setMicUI();
      setVoiceStatus("");
      if (coreEl.getAttribute("data-state") === "listening") setCoreState("idle");
    }

    function toggleMicListening() {
      if (!SpeechRecognitionCtor) return;
      if (micEnabled) {
        teardownMic(true);
        return;
      }
      micEnabled = true;
      localStorage.setItem("mya-mic-enabled", "on");
      setMicUI();
      showListeningIfIdle();
      startRecognition();
    }
    micBtn.addEventListener("click", toggleMicListening);

    // Guards against restarting the mic twice for the same reply -- once
    // from the early "she's about to finish" warm-up, and again from the
    // normal "ended" handler.
    var micRestartedForCurrentReply = false;

    function restartMicForNextTurn() {
      if (micRestartedForCurrentReply) return;
      micRestartedForCurrentReply = true;
      pausedForPlayback = false;
      if (!micEnabled) return;
      // She's finishing up -- stay in "listening for your answer" mode for
      // a few seconds instead of requiring the wake word again.
      enterAwakeMode();
      startRecognition();
    }

    // settleCore is defined at module scope (see Mya Core state controller
    // above) and drives what a temporary state (like "speaking") settles
    // back to once its hold period ends. Point it at the mic here so that
    // path also lands on "listening" instead of "idle" when appropriate.
    settleCore = function () {
      setCoreState(micEnabled ? "listening" : "idle");
    };

    function stopSpeakingAnimation() {
      restartMicForNextTurn();
      settleCore();
    }

    // Real audio, when present, drives the speaking->next-state transition
    // itself (ended/error) instead of the generic fixed-timeout fallback --
    // the Core stays visibly "speaking" for exactly as long as she's
    // actually talking, not an approximation.
    function playReplyAudio(audioBase64) {
      if (!audioBase64 || !voiceEnabled) return false;
      try {
        if (currentAudio) { currentAudio.pause(); currentAudio.src = ""; }
        currentAudio = new Audio("data:audio/mpeg;base64," + audioBase64);
        clearTimeout(idleTimer);
        micRestartedForCurrentReply = false;
        currentAudio.addEventListener("ended", stopSpeakingAnimation);
        currentAudio.addEventListener("error", function () {
          console.error("Mya voice playback error:", currentAudio && currentAudio.error);
          stopSpeakingAnimation();
        });
        // Start warming the recognizer back up shortly before she actually
        // finishes (real startup lag otherwise eats the first word or two
        // of whatever's said next) -- close enough to the end that it's
        // just her trailing silence, not her actual voice.
        var EARLY_RESTART_SECONDS = 0.3;
        currentAudio.addEventListener("timeupdate", function () {
          var d = currentAudio.duration;
          if (d && isFinite(d) && currentAudio.currentTime >= d - EARLY_RESTART_SECONDS) {
            restartMicForNextTurn();
          }
        });
        // recognition.stop() is async -- wait for onend's confirmation
        // before playing, otherwise the still-live mic can hear the first
        // few words of her own reply and mistake them for a new command.
        pauseWakeListening().then(function () {
          currentAudio.play().catch(function (err) {
            console.error("Mya voice play() failed:", err);
            stopSpeakingAnimation();
          });
        });
        return true;
      } catch (e) {
        stopSpeakingAnimation();
        return false;
      }
    }

    function performSend(message) {
      sendBtn.disabled = true;
      addLine(message, "user");
      history.push({ role: "user", content: message });

      MyaEvents.emit("mya.thinking", { dev: false });

      fetch("/api/command-center-ask-mya", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, history: history.slice(-20), voice: voiceEnabled }),
      })
        .then(function (res) {
          if (res.status === 401) {
            MyaEvents.emit("mya.idle", { dev: false });
            teardownMic(false); // stop listening while logged out; preference survives the next login
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
            settleCore();
            return;
          }
          var reply = result.data.reply || "(no reply)";
          addLine(reply, "mya");
          history.push({ role: "assistant", content: reply });
          MyaEvents.emit("mya.responding", { dev: false });
          var playing = playReplyAudio(result.data.audioBase64);
          if (!playing) restartMicForNextTurn(); // no audio (muted or unavailable) -- resume listening right away rather than waiting on the fallback timeout

          // Keep the workspace panels in sync with whatever Mya just did --
          // same tool-name matching the existing dashboard uses, just
          // targeting the new panels' load functions.
          var toolsUsed = Array.isArray(result.data.toolsUsed) ? result.data.toolsUsed : [];
          if (toolsUsed.indexOf("add_contractor") !== -1 || toolsUsed.indexOf("remove_contractor") !== -1) loadContractors();
          if (toolsUsed.indexOf("resolve_approval") !== -1) loadApprovals();
          if (toolsUsed.indexOf("remember_fact") !== -1) loadMemoryFacts();
          if (toolsUsed.indexOf("create_project") !== -1 || toolsUsed.indexOf("update_project") !== -1) loadProjects();
          if (toolsUsed.indexOf("create_appointment") !== -1) loadKpis();
          if (toolsUsed.indexOf("undo_last_action") !== -1) loadWorkspace();
        })
        .catch(function () {
          addLine("Couldn't reach Mya — try again.", "mya");
          MyaEvents.emit("mya.idle", { dev: false });
          settleCore();
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var message = input.value.trim();
      if (!message) return;
      input.value = "";
      performSend(message);
    });

    setMicUI();
    if (micEnabled) {
      showListeningIfIdle();
      startRecognition();
    }
  }

  /* ---------------- Reveal the shell once a real session is confirmed ---------------- */
  /* ---------------- Workspace panels (Milestone 4-5) ----------------
     Each load* function below hits the EXACT same existing endpoint the
     current Command Center uses, with the exact same response field
     mapping -- no backend change, no new endpoint. Read-only in this
     pass: the write actions these panels' old counterparts had (approve/
     decline, add contractor, forget a memory) still work today through
     natural-language chat below; wiring them as direct panel controls is
     a further step, not done here. */
  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  function formatRelative(iso) {
    if (!iso) return "";
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hr" + (hrs === 1 ? "" : "s") + " ago";
    var days = Math.round(hrs / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  async function loadKpis() {
    try {
      var res = await fetch("/api/command-center-data");
      if (!res.ok) return;
      var data = await res.json();
      var container = document.getElementById("wp-kpis");
      var items = [
        { label: "Today's Calls", value: data.todaysCalls && data.todaysCalls.value },
        { label: "New Leads", value: data.newLeads && data.newLeads.value },
      ];
      container.innerHTML = items.map(function (it) {
        return '<div class="wp-kpi-card"><div class="wp-kpi-value">' + (it.value == null ? "—" : it.value) +
          '</div><div class="wp-kpi-label">' + escapeHtml(it.label) + "</div></div>";
      }).join("");

      if (data.newLeads && Array.isArray(data.newLeads.recent)) {
        var leadsEl = document.getElementById("wp-leads");
        leadsEl.innerHTML = data.newLeads.recent.map(function (l) {
          return '<div class="wp-row"><div class="wp-row-main"><strong>' + escapeHtml(l.name) +
            '</strong><span>' + escapeHtml(l.interest || "—") + " · " + escapeHtml(l.source || "—") +
            '</span></div><div class="wp-row-side">' + escapeHtml(formatRelative(l.receivedAt)) + "</div></div>";
        }).join("");
      }

      if (Array.isArray(data.recentActivity)) {
        var activityEl = document.getElementById("wp-activity");
        activityEl.innerHTML = data.recentActivity.map(function (a) {
          return '<div class="wp-row"><div class="wp-row-main"><span>' + escapeHtml(a.text) +
            '</span></div><div class="wp-row-side">' + escapeHtml(formatRelative(a.time)) + "</div></div>";
        }).join("");
      }

      if (data.memoryInsights) {
        var m = data.memoryInsights;
        var rows = [
          [m.totalContactsRemembered, "Contacts remembered"],
          [m.recurringCustomers, "Recurring customers"],
          [m.notesLoggedThisWeek, "Notes logged this week"],
        ];
        document.getElementById("wp-memory-insights").innerHTML = rows.map(function (r) {
          return '<div class="wp-row"><div class="wp-row-main"><strong>' + (r[0] == null ? "—" : r[0]) +
            "</strong></div><div class=\"wp-row-side\">" + escapeHtml(r[1]) + "</div></div>";
        }).join("");
      }

      if (Array.isArray(data.schedule)) {
        document.getElementById("wp-schedule").innerHTML = data.schedule.map(function (s) {
          return '<div class="wp-row"><div class="wp-row-main"><span>' + escapeHtml(s.label) +
            '</span></div><div class="wp-row-side">' + escapeHtml(s.time) + "</div></div>";
        }).join("");
      }

      if (Array.isArray(data.workingNow)) {
        var workingEl = document.getElementById("wp-working-now");
        workingEl.innerHTML = data.workingNow.length
          ? data.workingNow.map(function (t) { return "<li>" + escapeHtml(t) + "</li>"; }).join("")
          : "";
      }

      if (Array.isArray(data.services)) {
        document.getElementById("wp-services").innerHTML = data.services.map(function (s) {
          return '<div class="wp-service-row"><span>' + escapeHtml(s.name) + '</span><span class="wp-service-status">' +
            '<span class="wp-dot ' + (s.connected ? "on" : "off") + '"></span>' + (s.connected ? "Connected" : "Not connected") + "</span></div>";
        }).join("");
      }
    } catch (e) { /* leave panel empty rather than showing an error UI */ }
  }

  async function loadApprovals() {
    try {
      var res = await fetch("/api/command-center-approvals");
      if (!res.ok) return;
      var data = await res.json();
      if (!Array.isArray(data.approvals)) return;
      document.getElementById("wp-approvals-count").textContent = data.approvals.length;
      document.getElementById("wp-approvals").innerHTML = data.approvals.map(function (a) {
        return '<div class="wp-approval-card"><strong>' + escapeHtml(a.title) + "</strong><br><span>" +
          escapeHtml(a.detail || "") + '</span><div class="wp-meta">Requested ' + escapeHtml(formatRelative(a.requested_at)) +
          '</div><div class="wp-approval-actions">' +
          '<button type="button" data-approval-id="' + a.id + '" data-action="approve">Approve</button>' +
          '<button type="button" data-approval-id="' + a.id + '" data-action="decline">Decline</button></div></div>';
      }).join("");
    } catch (e) { /* leave panel empty */ }
  }

  async function loadProjects() {
    try {
      var res = await fetch("/api/command-center-projects");
      if (!res.ok) return;
      var data = await res.json();
      if (!Array.isArray(data.projects)) return;
      document.getElementById("wp-projects").innerHTML = data.projects.map(function (p) {
        var name = p.client_name ? p.project_name + " — " + p.client_name : p.project_name;
        var issue = p.next_action || p.outstanding_decisions || "No action set";
        return '<div class="wp-row"><div class="wp-row-main"><strong>' + escapeHtml(name) + "</strong><span>" +
          escapeHtml(issue) + '</span></div><div class="wp-row-side">' + escapeHtml(p.status || "") + "</div></div>";
      }).join("");
    } catch (e) { /* leave panel empty */ }
  }

  async function loadContractors() {
    try {
      var res = await fetch("/api/command-center-contractors");
      if (!res.ok) return;
      var data = await res.json();
      if (!Array.isArray(data.contractors)) return;
      document.getElementById("wp-contractors").innerHTML = data.contractors.map(function (c) {
        return '<div class="wp-row"><div class="wp-row-main"><strong>' + escapeHtml(c.name) + " (" + escapeHtml(c.category || "—") +
          ")</strong><span>" + escapeHtml(c.notes || "—") + (c.pricing_rate ? " · " + escapeHtml(c.pricing_rate) : "") +
          '</span></div><div class="wp-row-side">' + escapeHtml(c.phone || "—") + "</div></div>";
      }).join("");
    } catch (e) { /* leave panel empty */ }
  }

  async function loadMemoryFacts() {
    try {
      var res = await fetch("/api/command-center-memory");
      if (!res.ok) return;
      var data = await res.json();
      if (!Array.isArray(data.facts)) return;
      document.getElementById("wp-memory-facts").innerHTML = data.facts.map(function (f) {
        return '<div class="wp-row"><div class="wp-row-main"><span>' + escapeHtml(f.fact) +
          '</span></div><div class="wp-row-side">' + escapeHtml(formatRelative(f.created_at)) + "</div></div>";
      }).join("");
    } catch (e) { /* leave panel empty */ }
  }

  function loadWorkspace() {
    loadKpis();
    loadApprovals();
    loadProjects();
    loadContractors();
    loadMemoryFacts();
  }

  // Delegated click handler for approve/decline -- one listener on the
  // panel container rather than one per card, so re-rendering the list
  // (loadApprovals()) never leaves stale listeners behind.
  document.getElementById("wp-approvals").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-approval-id]");
    if (!btn) return;
    var id = btn.getAttribute("data-approval-id");
    var action = btn.getAttribute("data-action");
    var card = btn.closest(".wp-approval-card");
    var buttons = card.querySelectorAll("button");
    buttons.forEach(function (b) { b.disabled = true; });
    fetch("/api/command-center-approvals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, action: action }),
    })
      .then(function (res) {
        if (res.status === 401) { showLoginOverlay(); return; }
        if (!res.ok) throw new Error("failed");
        loadApprovals();
      })
      .catch(function () {
        buttons.forEach(function (b) { b.disabled = false; });
      });
  });

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
    loadWorkspace();
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
