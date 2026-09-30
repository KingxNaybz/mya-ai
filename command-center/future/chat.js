/**
 * Mya Chat + Voice — the conversation surface.
 *
 * The voice pipeline below is the Build 12 port of the classic dashboard's
 * pipeline, kept behavior-for-behavior: same /api/command-center-ask-mya
 * request, same wake word + near-homophones, same 45s follow-up window,
 * same 3s quiet period before sending, same mic pause while she speaks
 * (waiting for onend), same generation guard against stale recognizer
 * instances, same early warm-up 0.3s before playback ends, same shared
 * localStorage keys (mya-voice-enabled / mya-mic-enabled) with the classic
 * dashboard. ElevenLabs audio is whatever the backend returns -- unchanged.
 *
 * Phase 1 changes are wiring only:
 *   - Core state goes through window.MyaCore instead of local closures.
 *   - A 401 emits "auth.expired" (app.js shows the login overlay).
 *   - Panel refreshes after tool calls go through MyaData.refreshForTools.
 *   - Mic / voice toggles may appear in more than one place (Home hero and
 *     the Mya view); every [data-mic-toggle] / [data-voice-toggle] button
 *     drives and reflects the same single state.
 *   - Each log line is also broadcast as "chat.line" so Home can show the
 *     latest exchange.
 */
(function (global) {
  "use strict";

  var performSendRef = null;

  function initChat() {
    var form = document.getElementById("mf-command-form");
    var input = document.getElementById("mf-command-input");
    var log = document.getElementById("mf-command-log");
    var sendBtn = document.getElementById("mf-command-send");
    var voiceToggleBtns = document.querySelectorAll("[data-voice-toggle]");
    var micBtns = document.querySelectorAll("[data-mic-toggle]");
    var voiceStatusEls = document.querySelectorAll("[data-voice-status]");
    var history = [];
    var voiceEnabled = localStorage.getItem("mya-voice-enabled") !== "off";
    // Optional Hermes route: off by default, per-page (never persisted), and
    // the toggle only appears while a live Systems check reports Hermes up.
    var useHermes = false;
    var providerBtn = document.getElementById("mya-provider-toggle");
    var runtimeLine = document.getElementById("mya-runtime");

    function hermesUp() {
      var sys = MyaData.get("systems");
      var list = sys && sys.data && Array.isArray(sys.data.systems) ? sys.data.systems : [];
      var hermes = list.filter(function (x) { return x && x.id === "hermes"; })[0];
      return MyaLib.integrationStatus(hermes, MyaData.freshness("systems")).state === "up";
    }

    function applyProviderUI() {
      var available = hermesUp();
      if (!available) useHermes = false;
      providerBtn.hidden = !available;
      providerBtn.setAttribute("aria-pressed", useHermes ? "true" : "false");
      providerBtn.querySelector("[data-label]").textContent = useHermes ? "Asking Hermes (text only)" : "Ask the Hermes runtime";
    }
    providerBtn.addEventListener("click", function () { useHermes = !useHermes; applyProviderUI(); });
    MyaEvents.on("data.changed", function (d) { if (d && d.source === "systems") applyProviderUI(); });
    var currentAudio = null;

    // meta (Mya replies only): { toolsUsed, provider } -- shown as small
    // chips so it's always visible what she actually looked at or changed.
    function addLine(text, role, meta) {
      var line = document.createElement("div");
      line.className = "chat-line " + role;
      var who = document.createElement("div");
      who.className = "chat-who";
      who.textContent = role === "user" ? "You" : "Mya";
      var body = document.createElement("div");
      body.className = "chat-text";
      body.textContent = text;
      line.appendChild(who);
      line.appendChild(body);
      if (meta && Array.isArray(meta.toolsUsed) && meta.toolsUsed.length) {
        var tools = document.createElement("div");
        tools.className = "chat-tools";
        var seen = {};
        meta.toolsUsed.forEach(function (t) {
          if (seen[t]) return;
          seen[t] = true;
          var chip = document.createElement("span");
          chip.className = "chip-tag";
          chip.textContent = MyaLib.toolLabel(t);
          tools.appendChild(chip);
        });
        line.appendChild(tools);
      }
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
      document.getElementById("chat-empty").hidden = true;
      MyaEvents.emit("chat.line", { role: role, text: text });
    }

    function setVoiceStatus(text) {
      for (var i = 0; i < voiceStatusEls.length; i++) {
        voiceStatusEls[i].hidden = !text;
        voiceStatusEls[i].textContent = text || "";
      }
    }

    function applyVoiceToggleUI() {
      for (var i = 0; i < voiceToggleBtns.length; i++) {
        var b = voiceToggleBtns[i];
        b.classList.toggle("is-muted", !voiceEnabled);
        b.setAttribute("aria-pressed", voiceEnabled ? "true" : "false");
        b.title = voiceEnabled
          ? "Mya speaks her replies out loud (click to mute)"
          : "Mya's voice is muted (click to unmute)";
        var lbl = b.querySelector("[data-label]");
        if (lbl) lbl.textContent = voiceEnabled ? "Voice on" : "Muted";
      }
      MyaEvents.emit("voice.changed", { voiceEnabled: voiceEnabled });
    }
    applyVoiceToggleUI();

    function onVoiceToggle() {
      voiceEnabled = !voiceEnabled;
      localStorage.setItem("mya-voice-enabled", voiceEnabled ? "on" : "off");
      applyVoiceToggleUI();
      if (!voiceEnabled && currentAudio) currentAudio.pause();
    }
    for (var vi = 0; vi < voiceToggleBtns.length; vi++) voiceToggleBtns[vi].addEventListener("click", onVoiceToggle);

    /* ---- Always-listen wake word ("Mya") ---- */
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
      for (var i = 0; i < micBtns.length; i++) {
        var b = micBtns[i];
        if (!SpeechRecognitionCtor) {
          b.disabled = true;
          b.title = "Voice input isn't supported in this browser — try Chrome or Edge.";
          continue;
        }
        b.classList.toggle("is-on", micEnabled);
        b.classList.toggle("is-listening", micEnabled && !awake);
        b.setAttribute("aria-pressed", micEnabled ? "true" : "false");
        b.title = micEnabled ? 'Always listening for "Mya" — click to turn off' : 'Click to always listen for "Mya"';
        var lbl = b.querySelector("[data-label]");
        if (lbl) lbl.textContent = micEnabled ? "Mic on" : "Mic off";
      }
      MyaEvents.emit("mic.changed", { micEnabled: micEnabled, supported: Boolean(SpeechRecognitionCtor) });
    }

    // Only flips the Core to "listening" if it's currently idle -- never
    // steals the display from a thinking/speaking transition in flight.
    function showListeningIfIdle() {
      if (MyaCore.getState() === "idle") MyaCore.setState("listening");
    }

    // Resolves only once the mic has actually confirmed it stopped
    // (recognition.onend fired) -- .stop() itself is async in every browser.
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
        // Safety net: some browsers never fire onend for a stop() call on an
        // already-idle recognizer.
        setTimeout(finish, 500);
        try {
          recognition.stop();
        } catch (e) {
          finish();
        }
      });
    }

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

    // Buffer finalized speech and wait for a real quiet period before
    // sending -- Chrome finalizes on any pause, including mid-sentence.
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

      var WAKE_WORD = /\b(mya|maya|mia|nia)\b/i;

      recognition.onresult = function (event) {
        var result = event.results[event.results.length - 1];
        var transcript = result[0].transcript.trim();
        if (!transcript) return;

        if (!awake) {
          if (!WAKE_WORD.test(transcript)) return;
          enterAwakeMode();
          if (!result.isFinal) return;
        } else {
          resetAwakeTimer();
          if (pendingSendTimer) extendPendingSend();
        }

        if (!result.isFinal) return;

        var after = transcript.replace(new RegExp("^.*" + WAKE_WORD.source + "[,:]?\\s*", "i"), "").trim();
        if (after) queueSpeechForSend(after);
      };

      recognition.onerror = function (event) {
        console.error("Mya mic error:", event.error);
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          teardownMic(true);
          setVoiceStatus("Mic permission denied — click the icon left of the address bar, allow microphone access, then turn the mic on again.");
        } else if (event.error === "audio-capture") {
          teardownMic(true);
          setVoiceStatus("No microphone found — check that one is connected and try again.");
        } else if (event.error === "network") {
          setVoiceStatus("Having trouble reaching the speech recognition service — check your internet connection.");
        }
      };

      recognition.onend = function () {
        // A newer instance has already taken over -- stale event, ignore.
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
        setVoiceStatus("Couldn't start the microphone — check the browser's site permissions and try again.");
      }
    }

    // persistOff writes the "off" preference (a real user/error turn-off);
    // a session-expiry teardown passes false so the mic resumes after login.
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
      if (MyaCore.getState() === "listening") MyaCore.setState("idle");
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
    for (var mi = 0; mi < micBtns.length; mi++) micBtns[mi].addEventListener("click", toggleMicListening);

    // Guards against restarting the mic twice for the same reply.
    var micRestartedForCurrentReply = false;

    function restartMicForNextTurn() {
      if (micRestartedForCurrentReply) return;
      micRestartedForCurrentReply = true;
      pausedForPlayback = false;
      if (!micEnabled) return;
      enterAwakeMode();
      startRecognition();
    }

    MyaCore.setSettle(function () {
      MyaCore.setState(micEnabled ? "listening" : "idle");
    });

    function stopSpeakingAnimation() {
      restartMicForNextTurn();
      MyaCore.settle();
    }

    function playReplyAudio(audioBase64) {
      if (!audioBase64 || !voiceEnabled) return false;
      try {
        if (currentAudio) { currentAudio.pause(); currentAudio.src = ""; }
        currentAudio = new Audio("data:audio/mpeg;base64," + audioBase64);
        MyaCore.clearIdleTimer();
        micRestartedForCurrentReply = false;
        currentAudio.addEventListener("ended", stopSpeakingAnimation);
        currentAudio.addEventListener("error", function () {
          console.error("Mya voice playback error:", currentAudio && currentAudio.error);
          stopSpeakingAnimation();
        });
        var EARLY_RESTART_SECONDS = 0.3;
        currentAudio.addEventListener("timeupdate", function () {
          var d = currentAudio.duration;
          if (d && isFinite(d) && currentAudio.currentTime >= d - EARLY_RESTART_SECONDS) {
            restartMicForNextTurn();
          }
        });
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
        body: JSON.stringify(useHermes
          ? { message: message, history: history.slice(-20), voice: voiceEnabled, provider: "hermes" }
          : { message: message, history: history.slice(-20), voice: voiceEnabled }),
      })
        .then(function (res) {
          if (res.status === 401) {
            MyaEvents.emit("mya.idle", { dev: false });
            teardownMic(false); // stop listening while logged out; preference survives the next login
            MyaEvents.emit("auth.expired", { source: "ask-mya" });
            return null;
          }
          return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data || {} }; });
        })
        .then(function (result) {
          if (!result) return; // handled above (401)
          if (!result.ok) {
            var err = result.data.error;
            addLine(
              err === "not_configured" ? "Mya's brain isn't configured on the server yet, so she can't answer here."
              : err === "hermes_not_configured" ? "The Hermes runtime isn't configured for the Command Center."
              : result.status >= 500 ? "Mya hit a problem answering that — try again in a moment."
              : err || "Something went wrong — try again.",
              "mya error");
            MyaEvents.emit("mya.idle", { dev: false });
            MyaCore.settle();
            return;
          }
          var reply = result.data.reply || "(no reply)";
          addLine(reply, "mya", { toolsUsed: result.data.toolsUsed, provider: result.data.provider });
          if (runtimeLine) runtimeLine.textContent = MyaLib.providerLabel(result.data.provider) + ".";
          history.push({ role: "assistant", content: reply });
          MyaEvents.emit("mya.responding", { dev: false });
          var playing = playReplyAudio(result.data.audioBase64);
          if (!playing) restartMicForNextTurn();

          MyaData.refreshForTools(result.data.toolsUsed);
        })
        .catch(function () {
          addLine("Couldn't reach Mya — try again.", "mya error");
          MyaEvents.emit("mya.idle", { dev: false });
          MyaCore.settle();
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    }
    performSendRef = performSend;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var message = input.value.trim();
      if (!message) return;
      input.value = "";
      performSend(message);
    });

    // A session expiring anywhere (not just in chat) stops the mic, keeping
    // the preference so it resumes after the next login.
    MyaEvents.on("auth.expired", function () { teardownMic(false); });

    setMicUI();
    if (micEnabled) {
      showListeningIfIdle();
      startRecognition();
    }
  }

  global.MyaChat = {
    init: initChat,
    // Used by the Home quick-ask box and suggestion chips -- the exact same
    // request path as typing in the Mya view.
    send: function (message) {
      message = String(message || "").trim();
      if (message && performSendRef) performSendRef(message);
    }
  };
})(window);
