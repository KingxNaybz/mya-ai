# Command Center Phase 3: continuous refinement

Started 2026-09-30 on `claude/cc-phase2-executive`. The mode is active
product refinement: the work is committed locally in small checkpoints, and
nothing is pushed, merged or deployed.

## Delivered
| Commit | What |
|---|---|
| 979391b | Executive Mya is the only assistant: no Claude fallback, chat disabled when she's unavailable |
| d0459d3 | Mya Presence Layer: rail dock, strip, phone ring, toast; resting approval Core |
| 7294891 | Ask Mya about this, on every module; fix for the question being sent twice in chat history |
| 451e497 | Operations "Mya · this session" feed; header grouping fix |
| f2761bb | Ask about a single approval; presence leads to Approvals when she's waiting on you |
| 4757e6c | Systems health overview first; data-sources table moved down |
| 78b2fb7 / 52add7f | Home presence line; warm resting approval Core (a styles.css override; core.css unchanged) |
| 570690b | Contextual ⌘K / "/" shortcut; staggered view entrance |
| 73be9ba | Chat timestamps and Copy; the dock orb follows presence |
| 824299b | Real audit log on Operations |
| 3d04153 … e785c20 | Voice experience and Core states; quieter Live tags; gold decision cards; living Constellation; phone/tablet clusters; voice-capsule mute; Devices shows tap-to-talk, mic and wake word |
| 18a2504 | Preview server: `--mode=fixtures` never drops to the login screen; a local "preview server stopped" screen reconnects by itself |
| a94c9cf | The Core flies between slots on route change |
| (this) | Memory: "Ask Mya about “X”" on Hindsight search results, with the results as context |

Contracts are in `agent-os/standards/frontend/presence-and-ask-mya.md`.

## Deliberately not faked
- A "working" / background state: nothing reports Hermes background work to the Command Center.
- Mya's full activity history: the session feed is this tab only. Her real history lives in Hermes.
- Hermes health: "Connected" appears only after a real reply in this session.

## Open items outside local refinement
- The Hermes endpoint's identity is NOT verified (see the Phase 2 `references.md`). The read-only VPS procedure was handed to the owner.
- Preview testing needs Preview-scoped env vars and owner approval. See the Phase 2 conversation notes: HERMES_BRIDGE_KEY, SUPABASE_*, DASHBOARD_PASSWORD/SESSION_SIGNING_SECRET, and ELEVENLABS_* for voice.
- update_company_brain (level 3) still writes directly (known gap from Phase 2).

## Next candidates
