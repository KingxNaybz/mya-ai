/**
 * MyaVoice: tap-to-talk and the voice capsule.
 *
 * Voice is another way to talk to the same Executive Mya, not a separate
 * assistant: a finished turn goes through MyaChat.send (the one chat path,
 * the one conversation, the one runtime) with voice: true. On a module
 * screen the question carries that screen's context (MyaAskAbout.contextFor)
 * so she can discuss what you're looking at.
 *
 *   tap  -> listening (live transcript) -> tap again or pause -> sent
 *        -> thinking -> waiting (no answer yet) -> speaking (Stop) -> done
 *
 * The capsule floats above every screen, so she keeps speaking, and can be
 * stopped, while you navigate. It also appears whenever she speaks a typed
 * reply, because Stop has to be reachable wherever you are.
 *
 * Honest failure: unsupported browser, blocked or missing mic, speech
 * service down, nothing heard, Executive Mya unavailable or not answering.
 * Each says what happened and that nothing was sent elsewhere.
 *
 * Presence: every [data-talk] control drives the same turn, including the
 * one in the status strip, so you can start talking from any screen. The
 * turn belongs to the page, not the Mya view: navigating while she listens,
 * thinks or speaks keeps it going, and the "About" tag follows the screen
 * you end up on (that screen's context is what's sent).
 *
 * Microphone permission is checked up front where the browser allows it
 * (Permissions API): a blocked mic shows on every talk control and says how
 * to fix it, instead of failing after a tap.
 *
 * Hands-free (the "Mya" wake word) stays in chat.js. While a tap-to-talk
 * turn records, the wake-word recognizer is paused (two conflict) and
 * resumed afterwards.
 *
 * DEV SIMULATION (?dev=1 only): MyaVoice.simulate() walks the capsule and
 * Core through every phase with synthetic text so the states can be
 * reviewed without a microphone or a runtime. It is labelled "Dev
 * simulation · not Mya", sets dev: true on every Core state, adds nothing
 * to the conversation and makes no network request.
 */
(function (global) {
  "use strict";

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SILENCE_MS = 1800;      // quiet time after speech before sending
  var NO_SPEECH_MS = 8000;    // give up if nothing is heard at all
  var DONE_HOLD_MS = 4200;
  var ERROR_HOLD_MS = 7000;

  var v = { phase: null };    // the capsule model (MyaLib.voiceCapsule input)
  var rec = null;
  var capturing = false;
  var finalText = "";
  var interimText = "";
  var speakingNow = false;    // her reply audio is playing
  var silenced = false;       // Mute is on (chat.js owns it)
  var micPerm = "unknown";    // granted | denied | prompt | unknown
  var silenceTimer = null, noSpeechTimer = null, hideTimer = null, tickTimer = null;
  var voiceTurn = false;      // the request in flight came from tap-to-talk
  var available = false;
  var sim = null;             // dev simulation handle
  var levelDecay = 0;

  function $(id) { return document.getElementById(id); }
  function extend(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (src) for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }
  function route() { return document.documentElement.getAttribute("data-route") || "home"; }

  /* ---------------- Capsule ---------------- */
  function render() {
    var cap = $("voice-capsule");
    if (!cap) return;
    var out = MyaLib.voiceCapsule(extend({}, v, { silenced: silenced }));
    document.documentElement.setAttribute("data-voice", out.visible ? out.phase : "");
    if (!out.visible) {
      cap.classList.remove("is-in");
      clearTimeout(cap._hide);
      cap._hide = setTimeout(function () { if (!v.phase) cap.hidden = true; }, 240);
      renderTalkButtons();
      return;
    }
    clearTimeout(cap._hide);
    cap.hidden = false;
    cap.setAttribute("data-phase", out.phase);
    cap.querySelector("[data-vc-label]").textContent = out.label;
    var detail = cap.querySelector("[data-vc-detail]");
    if (out.heardFinal != null || out.heardInterim != null) {
      // Final words solid, the still-changing guess dimmed.
      detail.innerHTML = '<span class="vc-final">' + MyaLib.escapeHtml(out.heardFinal || "") + "</span>" +
        (out.heardInterim ? ' <span class="vc-interim">' + MyaLib.escapeHtml(out.heardInterim) + "</span>" : "");
    } else {
      detail.textContent = out.detail;
    }
    cap.querySelector("[data-vc-dev]").hidden = !v.dev;
    var about = cap.querySelector("[data-vc-about]");
    about.hidden = !v.about;
    about.textContent = v.about ? "About: " + v.about : "";
    var primary = cap.querySelector("[data-vc-action]");
    primary.hidden = !out.action;
    primary.setAttribute("data-action", out.action || "");
    primary.querySelector("span").textContent = out.action === "send" ? "Done" : out.action === "stop" ? "Stop" : out.action === "review" ? "Review" : "";
    primary.setAttribute("aria-label", out.action === "send" ? "Send what you said" : out.action === "review" ? "Open Approvals" : "Stop Mya speaking");
    requestAnimationFrame(function () { cap.classList.add("is-in"); });
    renderTalkButtons();
  }

  function setPhase(phase, extra) {
    clearTimeout(hideTimer);
    v = extend({}, extra && extra.keep ? v : {}, extra || {}, { phase: phase });
    delete v.keep;
    render();
    if (phase === "completed") hideTimer = setTimeout(close, DONE_HOLD_MS);
    if (phase === "error") hideTimer = setTimeout(close, ERROR_HOLD_MS);
    clearInterval(tickTimer);
    if (phase === "waiting") tickTimer = setInterval(render, 1000);
  }

  function close() {
    clearTimeout(hideTimer);
    clearInterval(tickTimer);
    v = { phase: null };
    render();
  }

  function fail(code) {
    setPhase("error", { error: code, dev: false });
    var st = MyaCore.getState();
    if (st === "listening" || st === "thinking" || st === "waiting") MyaCore.setTemporary("error", 1800);
  }

  function renderTalkButtons() {
    var btns = document.querySelectorAll("[data-talk]");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var blocked = micPerm === "denied";
      b.classList.toggle("is-capturing", capturing);
      b.classList.toggle("is-speaking", speakingNow && !capturing);
      b.classList.toggle("is-blocked", blocked);
      b.setAttribute("aria-pressed", capturing ? "true" : "false");
      b.title = !SR ? "Voice input isn't available in this browser (try Chrome or Edge)"
        : !available ? "Executive Mya is unavailable"
        : blocked ? "Microphone blocked: allow it for this site in the address bar"
        : capturing ? "Tap to send what you said"
        : speakingNow ? "Interrupt Mya and talk (Ctrl+Shift+Space)"
        : "Tap to talk to Mya (Ctrl+Shift+Space)";
      b.setAttribute("aria-label", b.title);
      b.classList.toggle("is-unavailable", !SR || !available || blocked);
      var lbl = b.querySelector("[data-talk-label]");
      if (lbl) lbl.textContent = capturing ? "Listening… tap to send" : speakingNow ? "Tap to interrupt" : blocked ? "Microphone blocked" : "Tap to talk";
      var short = b.querySelector("[data-talk-short]");
      if (short) short.textContent = capturing ? "Send" : speakingNow ? "Interrupt" : "Talk";
    }
  }

  /* ---------------- Tap-to-talk ---------------- */
  function clearCaptureTimers() {
    clearTimeout(silenceTimer);
    clearTimeout(noSpeechTimer);
  }

  function heard() { return (finalText + " " + interimText).replace(/\s+/g, " ").trim(); }

  function bumpLevel() {
    // No second microphone stream: the Core's listening pulse follows the
    // recognizer's own results, rising on each word and easing back.
    levelDecay = 0.75;
    MyaCore.el.classList.add("has-level"); document.documentElement.classList.add("has-level");
    var step = function () {
      if (!capturing) return;
      levelDecay *= 0.9;
      document.documentElement.style.setProperty("--voice-level", levelDecay.toFixed(3));
      if (levelDecay > 0.02) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function start() {
    if (sim) stopSim();
    if (capturing) return finish();
    if (!SR) return fail("unsupported");
    if (!available) return fail("unavailable");
    if (micPerm === "denied") return fail("mic-denied");
    if (MyaChat.isBusy()) return setPhase("error", { error: "busy" });
    MyaChat.stopSpeaking(); // talking over her stops her
    capturing = true;
    finalText = interimText = "";
    var ctx = MyaAskAbout.contextFor(route());
    setPhase("listening", { about: ctx ? ctx.label : null, askPermission: micPerm === "prompt" });
    MyaCore.clearIdleTimer();
    MyaCore.setState("listening");
    MyaEvents.emit("voice.capture", { capturing: true, transcript: "" });

    MyaChat.pauseWake().then(function () {
      if (!capturing) return;
      rec = new SR();
      rec.lang = "en-US";
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = function (e) {
        var fin = "", inter = "";
        for (var i = 0; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) fin += r[0].transcript + " ";
          else inter += r[0].transcript + " ";
        }
        finalText = fin.trim();
        interimText = inter.trim();
        var text = heard();
        v.transcript = text;
        v.heardFinal = finalText;
        v.heardInterim = interimText;
        v.askPermission = false;
        render();
        MyaEvents.emit("voice.capture", { capturing: true, transcript: text });
        bumpLevel();
        clearTimeout(noSpeechTimer);
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(finish, SILENCE_MS);
      };
      rec.onerror = function (e) {
        var code = e.error === "not-allowed" || e.error === "service-not-allowed" ? "mic-denied"
          : e.error === "audio-capture" ? "no-mic"
          : e.error === "network" ? "speech-network"
          : e.error === "no-speech" ? "no-speech"
          : e.error === "aborted" ? null : "speech-network";
        if (code) endCapture(code);
      };
      rec.onend = function () { if (capturing) finish(); };
      try {
        rec.start();
      } catch (err) {
        endCapture("no-mic");
        return;
      }
      noSpeechTimer = setTimeout(function () { if (capturing && !heard()) endCapture("no-speech"); }, NO_SPEECH_MS);
    });
  }

  // Stop recording. With an error code, show it; otherwise just tidy up.
  function endCapture(code) {
    var wasCapturing = capturing;
    capturing = false;
    clearCaptureTimers();
    if (rec) {
      rec.onend = rec.onresult = rec.onerror = null;
      try { rec.abort(); } catch (e) { /* ignore */ }
      rec = null;
    }
    MyaCore.el.classList.remove("has-level"); document.documentElement.classList.remove("has-level");
    document.documentElement.style.setProperty("--voice-level", "0");
    MyaEvents.emit("voice.capture", { capturing: false, transcript: "" });
    MyaChat.resumeWake();
    if (code) fail(code);
    else if (wasCapturing && MyaCore.getState() === "listening") MyaCore.settle();
    renderTalkButtons();
  }

  function finish() {
    if (!capturing) return;
    var text = heard();
    var about = v.about;
    endCapture(text ? null : "no-speech");
    if (!text) return;
    var ctx = MyaAskAbout.contextFor(route());
    voiceTurn = true;
    setPhase("thinking", { transcript: text, about: about, startedAt: Date.now() });
    MyaChat.send(text, { voice: true, label: ctx ? ctx.label : undefined, context: ctx ? ctx.text : undefined, inline: true });
  }

  function cancel() {
    if (sim) return stopSim();
    if (capturing) { endCapture(null); close(); return; }
    if (v.phase === "speaking") { MyaChat.stopSpeaking(); return; }
    close();
  }

  /* ---------------- Real signals -> capsule ---------------- */
  function wire() {
    MyaEvents.on("mya.availability", function (a) {
      available = a.availability === "connected" || a.availability === "configured";
      renderTalkButtons();
    });
    MyaEvents.on("mya.waiting", function () {
      if (voiceTurn && v.phase === "thinking") setPhase("waiting", { keep: true });
    });
    MyaEvents.on("mya.outcome", function (o) {
      if (!voiceTurn) return;
      if (!o || !o.ok) { voiceTurn = false; setPhase("error", { error: "failed" }); }
    });
    MyaEvents.on("voice.reply", function (r) {
      var mine = voiceTurn;
      voiceTurn = false;
      if (r.audio) { setPhase("speaking", { keep: mine, reply: r.reply, transcript: mine ? v.transcript : "" }); return; }
      if (mine) setPhase("completed", { keep: true, reply: r.reply, muted: r.muted, noAudio: !r.muted });
    });
    MyaEvents.on("voice.speaking", function (s) {
      speakingNow = Boolean(s.on);
      renderTalkButtons();
      if (s.on) { if (v.phase !== "speaking") setPhase("speaking", { keep: true }); return; }
      if (v.phase === "speaking") {
        if (s.interrupted) close();
        else setPhase("completed", { keep: true });
      }
    });
    MyaEvents.on("auth.expired", function () { if (capturing) endCapture(null); close(); });
    MyaEvents.on("voice.muted", function (m) { silenced = m.muted; if (v.phase) render(); });

    // The turn outlives navigation; while listening, "About" follows you to
    // the screen whose context will be sent.
    window.addEventListener("hashchange", function () {
      if (!capturing) return;
      var ctx = MyaAskAbout.contextFor(route());
      v.about = ctx ? ctx.label : null;
      render();
    });

    var cap = $("voice-capsule");
    cap.querySelector("[data-vc-action]").addEventListener("click", function () {
      var a = this.getAttribute("data-action");
      if (a === "review") { location.hash = "#/approvals"; if (sim) stopSim(); else close(); return; }
      if (sim) return stopSim();
      if (a === "send") finish();
      else if (a === "stop") MyaChat.stopSpeaking();
    });
    cap.querySelector("[data-vc-close]").addEventListener("click", cancel);

    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest("[data-talk]");
      if (!t) return;
      e.preventDefault();
      start();
    });
    // The Core itself: tap her on Home or in the conversation to talk.
    ["core-slot-home", "core-slot-mya"].forEach(function (id) {
      var slot = $(id);
      if (!slot) return;
      slot.setAttribute("title", "Tap to talk to Mya");
      slot.addEventListener("click", function () { start(); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && (capturing || sim)) { e.preventDefault(); cancel(); }
      // Ctrl/Cmd+Shift+Space: talk from anywhere (again to send).
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "Space" || e.key === " ")) { e.preventDefault(); start(); }
    });
  }

  /* ---------------- Dev simulation (?dev=1 only) ---------------- */
  var SIM_SCRIPTS = {
    turn: [
      { phase: "listening", core: "listening", ms: 2600, words: "What needs my attention today on the Fixture projects" },
      { phase: "thinking", core: "thinking", ms: 1600 },
      { phase: "waiting", core: "waiting", ms: 1800 },
      { phase: "working", core: "working", ms: 1800 },
      { phase: "speaking", core: "speaking", ms: 3600, reply: "Synthetic dev reply: this is a simulated state, not Mya." },
      { phase: "completed", core: "completed", ms: 1800 }
    ],
    approval: [
      { phase: "listening", core: "listening", ms: 2200, words: "Send the revised estimate to Fixture Client B" },
      { phase: "thinking", core: "thinking", ms: 1400 },
      { phase: "working", core: "working", ms: 1600 },
      { phase: "speaking", core: "speaking", ms: 3000, reply: "Synthetic dev reply: drafted, and it needs your approval before it goes out." },
      { phase: "approval", core: "awaiting-approval", ms: 3200 }
    ],
    error: [
      { phase: "listening", core: "listening", ms: 2000, words: "Check the estimate" },
      { phase: "thinking", core: "thinking", ms: 1400 },
      { phase: "waiting", core: "waiting", ms: 2200 },
      { phase: "error", core: "error", ms: 3200, error: "failed" }
    ]
  };

  function simulate(kind) {
    var script = SIM_SCRIPTS[typeof kind === "string" && SIM_SCRIPTS[kind] ? kind : "turn"];
    if (!/[?&]dev=1\b/.test(location.search)) return;
    if (capturing) endCapture(null);
    stopSim();
    var i = 0;
    var t0 = Date.now();
    sim = { timers: [], raf: 0 };
    var next = function () {
      if (!sim) return;
      var s = script[i++];
      if (!s) { stopSim(); return; }
      MyaCore.setState(s.core, { dev: true });
      setPhase(s.phase, { keep: true, dev: true, startedAt: t0, reply: s.reply || v.reply, error: s.error });
      if (s.words) typeWords(s.words, s.ms);
      if (s.phase === "speaking") synthLevel(s.ms);
      sim.timers.push(setTimeout(next, s.ms));
    };
    next();
  }

  function typeWords(text, ms) {
    var words = text.split(" ");
    words.forEach(function (w, k) {
      sim.timers.push(setTimeout(function () {
        v.transcript = "(dev) " + words.slice(0, k + 1).join(" ");
        render();
        bumpSimLevel();
      }, (ms * 0.85 / words.length) * k));
    });
  }

  function bumpSimLevel() {
    MyaCore.el.classList.add("has-level"); document.documentElement.classList.add("has-level");
    document.documentElement.style.setProperty("--voice-level", (0.4 + Math.random() * 0.4).toFixed(3));
  }

  // A synthetic, clearly-not-audio level so the speaking Core can be reviewed.
  function synthLevel(ms) {
    var end = Date.now() + ms;
    MyaCore.el.classList.add("has-level"); document.documentElement.classList.add("has-level");
    var step = function () {
      if (!sim || Date.now() > end) { document.documentElement.style.setProperty("--voice-level", "0"); return; }
      var t = Date.now() / 1000;
      var lvl = Math.max(0, 0.45 + 0.35 * Math.sin(t * 9.1) * Math.sin(t * 2.3) + (Math.random() - 0.5) * 0.25);
      document.documentElement.style.setProperty("--voice-level", Math.min(1, lvl).toFixed(3));
      sim.raf = requestAnimationFrame(step);
    };
    sim.raf = requestAnimationFrame(step);
  }

  function stopSim() {
    if (!sim) return;
    sim.timers.forEach(clearTimeout);
    cancelAnimationFrame(sim.raf);
    sim = null;
    MyaCore.el.classList.remove("has-level"); document.documentElement.classList.remove("has-level");
    document.documentElement.style.setProperty("--voice-level", "0");
    MyaCore.setState(MyaCore.restingState());
    close();
  }

  function watchMicPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    navigator.permissions.query({ name: "microphone" }).then(function (st) {
      micPerm = st.state;
      renderTalkButtons();
      st.onchange = function () { micPerm = st.state; renderTalkButtons(); };
    }, function () { /* not queryable here: find out on first use */ });
  }

  function init() {
    wire();
    watchMicPermission();
    renderTalkButtons();
  }

  global.MyaVoice = { init: init, start: start, cancel: cancel, simulate: simulate, supported: Boolean(SR) };
})(window);
