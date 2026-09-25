/**
 * MyaEvents — a tiny, dependency-free pub/sub bus.
 *
 * This is the seam between "things that actually happen in the app" and
 * "things the visual layer reacts to." Nothing about this file knows what a
 * panel or the Mya Core look like; it just relays named events with an
 * optional detail payload to whoever subscribed.
 *
 * Event names are intentionally namespaced (mya.*, memory.*, project.*,
 * tool.*, agent.*, approval.*, task.*, communication.*) to match the future
 * event catalog from the interface redesign plan, even though Phase 1 only
 * ever emits a handful of them for real (see app.js). Emitting an event
 * that nothing has wired up yet is harmless -- it's simply not observed.
 *
 * REAL vs DEV events: by convention (enforced by callers, not this file),
 * every real emission in app.js carries no `dev` flag; anything emitted
 * only for visual/state-architecture preview during development sets
 * `detail.dev = true`. This file does not filter on that flag -- it is a
 * labeling convention for humans reading the code and for any future
 * listener that wants to visually distinguish "real system activity" from
 * "a developer is previewing a state," not a security or data boundary.
 */
(function (global) {
  "use strict";

  var listeners = Object.create(null);

  function on(eventName, handler) {
    if (!listeners[eventName]) listeners[eventName] = [];
    listeners[eventName].push(handler);
    return function off() {
      var list = listeners[eventName];
      if (!list) return;
      var idx = list.indexOf(handler);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  function off(eventName, handler) {
    var list = listeners[eventName];
    if (!list) return;
    var idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
  }

  function emit(eventName, detail) {
    var list = listeners[eventName];
    if (!list || list.length === 0) return;
    // Snapshot before iterating -- a handler unsubscribing itself (or
    // another handler) mid-emit must never skip or double-fire a listener.
    list.slice().forEach(function (handler) {
      try {
        handler(detail);
      } catch (err) {
        console.error('MyaEvents listener threw for "' + eventName + '":', err);
      }
    });
  }

  global.MyaEvents = { on: on, off: off, emit: emit };
})(window);
