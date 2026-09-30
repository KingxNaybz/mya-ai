# Mya Presence & "Ask Mya about this"

Executive Mya is the one assistant, and she's present on every screen.

## Presence (`presence.js`, `MyaLib.derivePresence`)
- Derived ONLY from real signals:
  - Core state (`core.state`)
  - the last request's outcome (`mya.outcome`)
  - Executive Mya availability (`mya.availability`)
  - the mic (`mic.changed`)
  - live/stale approvals
- Priority: thinking > waiting > speaking > recording (tap-to-talk) > error (5 min) > completed (60 s) > blocked > listening (wake word) > approval > idle
- No "working" / background state until something actually reports background work to the Command Center
- Unknown approvals (`null`) never count as zero, or as "waiting on you"
- Surfaces:
  - the rail dock
  - the strip
  - `html[data-presence]` (the phone tab-bar ring)
  - the toast (only when away from the Mya view, and not for questions answered in place)
  - the Operations "this session" feed
- "Waiting on you" links every presence surface to Approvals
- The session feed is this browser tab only, in memory. Never present it as her full history

## Chat outcome
- `MyaChat.send(message, { label, context, inline })` resolves `{ ok, reply }`
- Send the history as it was before the new message. The server appends the message itself
- Chat events: `chat.line` (+ `inline`), `mya.outcome` (`ok`, `reply`, `inline`), `mya.availability`

## "Ask Mya about this" (`ask-about.js`, `MyaLib.buildScreenContext`)
- Every module header gets Ask Mya. Home and Mya already center her
- The context note contains only data that loaded:
  - stale data is tagged "may be stale"
  - unloaded sources say "not connected"
  - lists are capped at 8
- The chat log shows an "About: <screen>" tag, never the context text
- Item-level asks (`MyaAskAbout.askAbout(view, q, focus, label)`) add a focus line. Approvals state that asking doesn't approve or decline anything
- Suggestions are fixed question templates, never data
- Everything is disabled, and says so, when Executive Mya is unavailable

## Voice (`voice.js`, `MyaLib.voiceCapsule`)
- Voice is another interface to the same Executive Mya: a finished turn goes through `MyaChat.send(text, { voice: true, ... })`, the one chat path and one conversation
- On a module screen a spoken question carries `MyaAskAbout.contextFor(route)`
- The capsule shows for a voice turn, and whenever she speaks any reply (Stop must be reachable on every screen). It suppresses the presence toast
- Failures name the cause (unsupported, mic blocked/missing, speech service, nothing heard, unavailable, didn't answer) and say nothing was sent elsewhere
- The dev simulation is `?dev=1` only, labelled "Dev simulation · not Mya", sets `dev: true` on Core states, adds nothing to the conversation and makes no request
- Hands-free is the existing wake word (chat.js). No always-on / wake-word claims beyond what the browser's speech recognition actually supports
- Command Center voice never touches the Reception/phone pipeline
