/**
 * "Ask Mya about this": Mya-first interaction on every module screen.
 *
 * Adds an Ask Mya control to each module header (not Home or Mya, which
 * already center her). It opens a bar where you ask about what's on
 * screen. The question goes through the one chat path (MyaChat.send) to
 * Executive Mya, with MyaLib.buildScreenContext() describing the screen,
 * and her answer shows right there. The same exchange is in the Mya
 * conversation, so "Continue" picks it up.
 *
 * Suggestions are fixed question templates, never data. When Executive Mya
 * is unavailable, the control is disabled and says so.
 */
(function (global) {
  "use strict";

  var VIEWS = ["projects", "approvals", "memory", "files", "operations", "devices", "systems"];
  var SUGGESTIONS = {
    projects: ["Which projects need my attention?", "What's blocking progress right now?"],
    approvals: ["Summarize what's waiting on me", "Which of these is most urgent?"],
    memory: ["What do you remember about my priorities?", "What have you learned about me recently?"],
    files: ["What have you prepared for me recently?"],
    operations: ["What are you working on right now?", "What's scheduled next?"],
    devices: ["Can you reach my Windows PC right now?"],
    systems: ["Is anything down or not connected?", "What should I fix first?"]
  };
  var SOURCES = ["projects", "projectDetail", "approvals", "systems"];
  var available = false;
  var bars = {};

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function snapshot() {
    var src = {};
    SOURCES.forEach(function (name) {
      var entry = MyaData.get(name);
      src[name] = { state: MyaData.freshness(name).state, data: entry && entry.data };
    });
    return src;
  }

  function build(view, section) {
    var head = section.querySelector(".view-head");
    if (!head) return;
    var ctx = MyaLib.buildScreenContext(view, {});
    var side = el("div", "view-head-side");
    var fresh = head.querySelector(":scope > [data-fresh]");
    if (fresh) side.appendChild(fresh);
    var btn = el("button", "ask-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="ask-orb" aria-hidden="true"></span><span>Ask Mya</span>';
    side.appendChild(btn);
    head.appendChild(side);

    var bar = el("div", "ask-about card");
    bar.hidden = true;
    var id = "ask-about-" + view;
    bar.id = id;
    btn.setAttribute("aria-controls", id);
    var form = el("form", "ask-form");
    form.setAttribute("autocomplete", "off");
    var orb = el("span", "ask-orb lg");
    orb.setAttribute("aria-hidden", "true");
    var input = el("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Ask Mya about " + ctx.label + "…";
    input.setAttribute("aria-label", "Ask Mya about " + ctx.label);
    var send = el("button", "icon-btn primary");
    send.type = "submit";
    send.setAttribute("aria-label", "Send to Mya");
    send.innerHTML = '<svg class="icon"><use href="#i-send"/></svg>';
    form.appendChild(orb); form.appendChild(input); form.appendChild(send);
    var chips = el("div", "chip-row ask-chips");
    (SUGGESTIONS[view] || []).forEach(function (q) {
      var c = el("button", "chip", q);
      c.type = "button";
      c.addEventListener("click", function () { ask(q); });
      chips.appendChild(c);
    });
    var hint = el("p", "ask-hint muted small", "She'll see a short summary of this screen with your question.");
    var answer = el("div", "ask-answer");
    answer.hidden = true;
    answer.setAttribute("aria-live", "polite");
    bar.appendChild(form); bar.appendChild(chips); bar.appendChild(hint); bar.appendChild(answer);
    head.insertAdjacentElement("afterend", bar);

    function open(show) {
      bar.hidden = !show;
      btn.setAttribute("aria-expanded", show ? "true" : "false");
      btn.classList.toggle("is-open", show);
      if (show) {
        requestAnimationFrame(function () { bar.classList.add("is-in"); });
        if (!input.disabled) input.focus({ preventScroll: true });
      } else {
        bar.classList.remove("is-in");
      }
    }

    function renderAnswer(state, question, text) {
      answer.hidden = false;
      answer.setAttribute("data-state", state);
      answer.textContent = "";
      answer.appendChild(el("p", "ask-q", "You asked: " + question));
      var body = el("div", "ask-reply");
      if (state === "thinking") body.innerHTML = '<span class="typing" aria-label="Mya is thinking"><i></i><i></i><i></i></span>';
      else body.textContent = text;
      answer.appendChild(body);
      if (state !== "thinking") {
        var more = el("a", "link-btn", "Continue in conversation →");
        more.href = "#/mya";
        answer.appendChild(more);
      }
    }

    function ask(question) {
      question = String(question || "").trim();
      if (!question || !available) return;
      var c = MyaLib.buildScreenContext(view, snapshot());
      input.value = "";
      input.disabled = send.disabled = true;
      renderAnswer("thinking", question);
      MyaChat.send(question, { label: c.label, context: c.text, inline: true }).then(function (r) {
        if (r && r.ok) renderAnswer("done", question, r.reply);
        else if (r && r.auth) answer.hidden = true;
        else renderAnswer("error", question, "Executive Mya didn't answer. Nothing was sent to another assistant. Try again in a moment.");
      }).then(function () { applyAvailability(); });
    }

    btn.addEventListener("click", function () { open(bar.hidden); });
    form.addEventListener("submit", function (e) { e.preventDefault(); ask(input.value); });
    bar.addEventListener("keydown", function (e) { if (e.key === "Escape") { open(false); btn.focus(); } });

    bars[view] = { btn: btn, input: input, send: send, chips: chips };
  }

  function applyAvailability() {
    Object.keys(bars).forEach(function (v) {
      var b = bars[v];
      b.btn.disabled = !available;
      b.btn.title = available ? "Ask Mya about this screen" : "Executive Mya is unavailable";
      b.input.disabled = b.send.disabled = !available;
      var cs = b.chips.querySelectorAll("button");
      for (var i = 0; i < cs.length; i++) cs[i].disabled = !available;
    });
  }

  function init() {
    VIEWS.forEach(function (v) {
      var section = document.querySelector('[data-view="' + v + '"]');
      if (section) build(v, section);
    });
    MyaEvents.on("mya.availability", function (a) {
      available = a.availability === "connected" || a.availability === "configured";
      applyAvailability();
    });
    applyAvailability();
  }

  global.MyaAskAbout = { init: init };
})(window);
