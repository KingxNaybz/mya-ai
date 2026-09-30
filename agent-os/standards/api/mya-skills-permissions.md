# Mya Skills & Permissions (command-center-ask-mya.ts)

`SKILLS` is the single source of truth — tool list, dispatcher, and `list_capabilities` derive from it. Add a capability = add one entry.

- Level by name: `get_` `list_` `calculate_` `evaluate_` `recall_` → 0 (read); everything else → 2
- Doesn't fit the default? Add to `PERMISSION_OVERRIDES` (e.g. `update_company_brain: 3`)
- Reversible writes call `logUndo(...)`; level 3+ must route through `mya_approvals`
- Every tool call → `logActionEvent` (best-effort, never blocks the reply)
- New write skill → add its name → sources to `TOOL_SOURCES` in `future/data.js`
- MCP (Hermes) exposes only level-0 skills in `MCP_TOOL_ALIASES`, re-checked at call time. Never expose writes
