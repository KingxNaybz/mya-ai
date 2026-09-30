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
 *
 * Voice experience (Phase 3): tap-to-talk lives in voice.js and sends
 * through this same performSend, so text and voice share one conversation
 * and one runtime (Executive Mya). Here:
 *   - "speaking" lasts exactly as long as her audio plays; Stop
 *     (MyaChat.stopSpeaking) interrupts it, and so does muting;
 *   - her real audio drives the Core's --voice-level (Web Audio analyser),
 *     only when the AudioContext is already running, so it can never
 *     silence playback;
 *   - a request with no answer after MyaLib.WAITING_AFTER_MS moves the Core
 *     to "waiting";
 *   - events: voice.speaking { on, interrupted }, voice.reply { audio,
 *     muted, reply, toolsUsed }.
 * The wake word ("Mya", always listening) is unchanged and is now labelled
 * as what it is: the hands-free wake word.
 */
(function (global) {
  "use strict";

  var performSendRef = null;
  var stopSpeakingRef = null;
  var isBusyRef = null;
  var wakeRef = null;

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
    // Executive Mya (Hermes) is the only assistant here. Chat is enabled only
    // while Systems reports her bridge configured, and there's no fallback to
    // another model. Once enabled, it stays enabled for the page unless
    // Systems explicitly reports her not configured, so a Systems outage
    // doesn't lock the owner out. "Connected" is claimed only after a real
    // reply, and it's cleared again if she fails to answer.
    var useHermes = false;
    var hermesVerifiedAt = null;
    var hermesFailed = false;
    var inFlight = false;
    var runtimeLine = document.getElementById("mya-runtime");

    function hermesRoute() {
      var sys = MyaData.get("systems");
      var list = sys && sys.data && Array.isArray(sys.data.systems) ? sys.data.systems : [];
      var hermes = list.filter(function (x) { return x && x.id === "hermes"; })[0];
      return MyaLib.executiveMyaRoute(hermes, MyaData.freshness("systems"));
    }

    function setRuntimeLine(text) { if (runtimeLine) runtimeLine.textContent = text; }

    function applyProviderUI() {
      var route = hermesRoute();
      if (route === "hermes") useHermes = true;
      else if (route === "not_configured") { useHermes = false; hermesVerifiedAt = null; }
      sendBtn.disabled = inFlight || !useHermes;
      input.disabled = !useHermes;
      input.placeholder = useHermes ? "Message Mya…" : "Executive Mya is unavailable";
      if (useHermes) {
        setRuntimeLine(hermesFailed
          ? "Executive Mya didn't answer the last message. Nothing was sent to another assistant."
          : hermesVerifiedAt
            ? "Connected to Executive Mya. Last reply at " + new Date(hermesVerifiedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "."
            : "Executive Mya (Hermes) is configured. Her first reply confirms the connection.");
      } else if (route === "not_configured") {
        setRuntimeLine("Executive Mya is unavailable: the Hermes bridge key isn't set on the server. Chat is off.");
      } else if (route === "loading") {
        setRuntimeLine("Checking Executive Mya's runtime…");
      } else {
        setRuntimeLine("Executive Mya: Not connected. Can't check her runtime right now, so chat is off.");
      }
      var homeInput = document.getElementById("home-ask-input");
      var homeSend = document.querySelector("#home-ask-form [type=submit]");
      if (homeInput) {
        homeInput.disabled = !useHermes;
        homeInput.placeholder = useHermes ? "Ask Mya anything…" : "Executive Mya is unavailable";
      }
      if (homeSend) homeSend.disabled = !useHermes;
      MyaEvents.emit("mya.availability", {
        availability: useHermes ? (hermesVerifiedAt ? "connected" : "configured")
          : route === "not_configured" ? "unavailable" : route === "loading" ? "loading" : "unknown"
      });
    }
    MyaEvents.on("data.changed", function (d) { if (d && d.source === "systems") applyProviderUI(); });
    applyProviderUI();
    var currentAudio = null;

    // meta.about (your lines): which screen an "Ask Mya about this" question
    // came from, shown as a small tag instead of the context text itself.
    // meta (Mya replies only): { toolsUsed } -- shown as small
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
      if (meta && meta.about) {
        var about = document.createElement("span");
        about.className = "chip-tag about-tag";
        about.textContent = "About: " + meta.about;
        who.appendChild(about);
      }
      if (meta && meta.voice) {
        var spoken = document.createElement("span");
        spoken.className = "chip-tag spoken-tag";
        spoken.textContent = "Spoken";
        spoken.title = "You said this out loud";
        who.appendChild(spoken);
      }
      var when = new Date();
      var time = document.createElement("time");
      time.className = "chat-time";
      time.dateTime = when.toISOString();
      time.textContent = when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      who.appendChild(time);
      // A real reply from Mya can be copied, e.g. into an email or a text.
      if (role === "mya" && navigator.clipboard) {
        var copy = document.createElement("button");
        copy.type = "button";
        copy.className = "chat-copy";
        copy.textContent = "Copy";
        copy.setAttribute("aria-label", "Copy Mya's reply");
        copy.addEventListener("click", function () {
          navigator.clipboard.writeText(text).then(function () {
            copy.textContent = "Copied";
            setTimeout(function () { copy.textContent = "Copy"; }, 1600);
          }, function () { copy.textContent = "Couldn't copy"; });
        });
        who.appendChild(copy);
      }
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
      MyaEvents.emit("chat.line", { role: role, text: text, inline: Boolean(meta && meta.inline), voice: Boolean(meta && meta.voice) });
    }

    // While a request is out, the log shows her working on it (real: it
    // exists exactly as long as the request does).
    var pendingEl = null;
    function showPending() {
      clearPending();
      pendingEl = document.createElement("div");
      pendingEl.className = "chat-line mya pending";
      pendingEl.setAttribute("aria-label", "Mya is thinking");
      pendingEl.innerHTML = '<div class="chat-who">Mya<span class="pending-label">Thinking</span></div>' +
        '<div class="chat-text"><span class="typing"><i></i><i></i><i></i></span></div>';
      log.appendChild(pendingEl);
      log.scrollTop = log.scrollHeight;
    }
    function clearPending() {
      if (pendingEl && pendingEl.parentNode) pendingEl.parentNode.removeChild(pendingEl);
      pendingEl = null;
    }
    MyaEvents.on("mya.waiting", function () {
      var lbl = pendingEl && pendingEl.querySelector(".pending-label");
      if (lbl) lbl.textContent = "Still working · waiting on her runtime";
    });

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
      if (!voiceEnabled) stopSpeaking();
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
        b.title = micEnabled ? 'Hands-free: always listening for "Mya". Click to turn off.' : 'Hands-free: click to always listen for the wake word "Mya"';
        var lbl = b.querySelector("[data-label]");
        if (lbl) lbl.textContent = micEnabled ? "Wake word on" : "Wake word off";
      }
      MyaEvents.emit("mic.changed", { micEnabled: micEnabled, supported: Boolean(SpeechRecognitionCtor) });
    }

    // Only flips the Core to "listening" if it's currently idle -- never
    // steals the display from a thinking/speaking transition in flight.
    function showListeningIfIdle() {
      var st = MyaCore.getState();
      if (st === "idle" || st === "awaiting-approval") MyaCore.setState("listening");
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
      if (MyaCore.getState() === "listening") MyaCore.setState(MyaCore.restingState());
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
      MyaCore.setState(micEnabled ? "listening" : MyaCore.restingState());
    });

    /* ---- Her real voice level -> the Core (--voice-level, 0..1) ----
       Routing an <audio> element through Web Audio sends its sound ONLY
       through the graph, so a suspended AudioContext would mean silence.
       The context is created and resumed on the first user gesture, and the
       analyser is attached only if it's already running; otherwise she
       speaks normally and the Core falls back to its CSS speaking pulse. */
    var audioCtx = null;
    var levelRaf = 0;
    function primeAudioContext() {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        if (!audioCtx) audioCtx = new Ctor();
        if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
      } catch (e) { audioCtx = null; }
    }
    document.addEventListener("pointerdown", primeAudioContext, { passive: true });
    document.addEventListener("keydown", primeAudioContext);

    function setVoiceLevel(v) {
      document.documentElement.style.setProperty("--voice-level", v.toFixed(3));
    }
    function stopLevel() {
      cancelAnimationFrame(levelRaf);
      levelRaf = 0;
      MyaCore.el.classList.remove("has-level");
      setVoiceLevel(0);
    }
    function trackLevel(audio) {
      if (!audioCtx || audioCtx.state !== "running") return;
      try {
        var source = audioCtx.createMediaElementSource(audio);
        var analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        var buf = new Uint8Array(analyser.fftSize);
        var smooth = 0;
        MyaCore.el.classList.add("has-level");
        var step = function () {
          if (audio !== currentAudio) return;
          analyser.getByteTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) { var x = (buf[i] - 128) / 128; sum += x * x; }
          var rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
          smooth = rms > smooth ? rms : smooth * 0.86 + rms * 0.14;
          setVoiceLevel(smooth);
          levelRaf = requestAnimationFrame(step);
        };
        levelRaf = requestAnimationFrame(step);
      } catch (e) {
        stopLevel();
      }
    }

    var speaking = false;
    function setSpeaking(on, interrupted) {
      if (speaking === on) return;
      speaking = on;
      if (!on) stopLevel();
      MyaEvents.emit("voice.speaking", { on: on, interrupted: Boolean(interrupted) });
    }

    // She finished (or couldn't play): a brief "completed", then settle.
    function stopSpeakingAnimation() {
      restartMicForNextTurn();
      var wasSpeaking = speaking;
      setSpeaking(false);
      if (wasSpeaking) MyaCore.setTemporary("completed", 1200);
      else MyaCore.settle();
    }

    // Stop button, Esc, muting, or talking over her.
    function stopSpeaking() {
      if (!currentAudio || !speaking) return false;
      try { currentAudio.pause(); } catch (e) { /* ignore */ }
      restartMicForNextTurn();
      setSpeaking(false, true);
      MyaCore.settle();
      return true;
    }

    function playReplyAudio(audioBase64) {
      if (!audioBase64 || !voiceEnabled) return false;
      try {
        if (currentAudio) { currentAudio.pause(); currentAudio.src = ""; }
        stopLevel();
        currentAudio = new Audio("data:audio/mpeg;base64," + audioBase64);
        var audio = currentAudio;
        MyaCore.clearIdleTimer();
        micRestartedForCurrentReply = false;
        trackLevel(audio);
        audio.addEventListener("playing", function () { if (audio === currentAudio) setSpeaking(true); });
        audio.addEventListener("ended", function () { if (audio === currentAudio) stopSpeakingAnimation(); });
        audio.addEventListener("error", function () {
          if (audio !== currentAudio) return;
          console.error("Mya voice playback error:", audio.error);
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
          if (audio !== currentAudio) return;
          audio.play().catch(function (err) {
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

    // opts (optional, from "Ask Mya about this"):
    //   label    which screen it's about, shown as a tag on your line
    //   context  MyaLib.buildScreenContext() text, sent to her after the
    //            question and kept in history so follow-ups have it
    //   inline   the asking screen shows the answer itself (no toast)
    // Resolves { ok, reply } so a caller can show the answer where it asked.
    function performSend(message, opts) {
      opts = opts || {};
      // Covers every entry point: this form, Home quick-ask, chips and voice.
      if (!useHermes) {
        addLine("Executive Mya is unavailable, so nothing was sent.", "mya error");
        return Promise.resolve({ ok: false, unavailable: true });
      }
      var outbound = opts.context ? message + "\n\n[Screen context from the Command Center]\n" + opts.context : message;
      inFlight = true;
      sendBtn.disabled = true;
      stopSpeaking(); // a new question interrupts the last answer
      addLine(message, "user", { about: opts.label, inline: opts.inline, voice: opts.voice });
      MyaEvents.emit("mya.thinking", { dev: false, voice: Boolean(opts.voice) });
      showPending();
      var waitTimer = setTimeout(function () { MyaEvents.emit("mya.waiting", { dev: false }); }, MyaLib.WAITING_AFTER_MS);

      var priorHistory = history.slice(-20);
      history.push({ role: "user", content: outbound });

      return fetch("/api/command-center-ask-mya", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: outbound, history: priorHistory, voice: voiceEnabled }),
      })
        .then(function (res) {
          clearPending();
          if (res.status === 401) {
            MyaEvents.emit("mya.idle", { dev: false });
            teardownMic(false); // stop listening while logged out; preference survives the next login
            MyaEvents.emit("auth.expired", { source: "ask-mya" });
            return { ok: false, auth: true };
          }
          return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data || {} }; });
        })
        .then(function (result) {
          if (result.auth) return result; // handled above (401)
          if (!result.ok) {
            var err = result.data.error;
            addLine(
              err === "executive_mya_unavailable" || result.status >= 500
                ? "Executive Mya didn't answer. Nothing was sent to another assistant. Try again in a moment."
                : err || "Something went wrong — try again.",
              "mya error");
            if (err === "executive_mya_unavailable" || result.status >= 500) { hermesFailed = true; hermesVerifiedAt = null; applyProviderUI(); }
            MyaEvents.emit("mya.idle", { dev: false });
            MyaCore.settle();
            MyaEvents.emit("mya.outcome", { ok: false, inline: opts.inline });
            return { ok: false };
          }
          var reply = result.data.reply || "(no reply)";
          addLine(reply, "mya", { toolsUsed: result.data.toolsUsed });
          hermesFailed = false;
          hermesVerifiedAt = Date.now();
          applyProviderUI();
          history.push({ role: "assistant", content: reply });
          MyaEvents.emit("mya.outcome", { ok: true, reply: reply, inline: opts.inline });
          var playing = playReplyAudio(result.data.audioBase64);
          MyaEvents.emit("voice.reply", { audio: playing, muted: !voiceEnabled, reply: reply, toolsUsed: result.data.toolsUsed || [], voice: Boolean(opts.voice) });
          MyaEvents.emit("mya.responding", { dev: false, audio: playing });
          if (!playing) restartMicForNextTurn();

          MyaData.refreshForTools(result.data.toolsUsed);
          return { ok: true, reply: reply };
        })
        .catch(function () {
          clearPending();
          addLine("Couldn't reach Executive Mya — try again.", "mya error");
          MyaEvents.emit("mya.idle", { dev: false });
          MyaCore.settle();
          MyaEvents.emit("mya.outcome", { ok: false, inline: opts.inline });
          return { ok: false };
        })
        .finally(function () {
          clearTimeout(waitTimer);
          inFlight = false;
          sendBtn.disabled = !useHermes;
        });
    }
    performSendRef = performSend;
    stopSpeakingRef = stopSpeaking;
    isBusyRef = function () { return inFlight; };
    wakeRef = {
      // Tap-to-talk needs the mic to itself: two recognizers conflict.
      pause: function () { return micEnabled ? pauseWakeListening() : Promise.resolve(); },
      resume: function () {
        pausedForPlayback = false;
        if (micEnabled && !speaking) startRecognition();
      }
    };
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && speaking) stopSpeaking();
    });

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
    send: function (message, opts) {
      message = String(message || "").trim();
      if (!message || !performSendRef) return Promise.resolve({ ok: false });
      return performSendRef(message, opts);
    },
    // Stop her mid-sentence. True if she was speaking.
    stopSpeaking: function () { return stopSpeakingRef ? stopSpeakingRef() : false; },
    isBusy: function () { return isBusyRef ? isBusyRef() : false; },
    pauseWake: function () { return wakeRef ? wakeRef.pause() : Promise.resolve(); },
    resumeWake: function () { if (wakeRef) wakeRef.resume(); }
  };
})(window);
