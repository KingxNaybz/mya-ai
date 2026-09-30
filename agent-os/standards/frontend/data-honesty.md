# Data Honesty (Command Center)

Nothing renders as real unless a fetch for it succeeded.

- Every data block shows freshness via `MyaLib.computeFreshness`:
  `live` | `stale` (old or last refresh failed) | `offline` ("Not connected") | `loading`
- Never show `0`, sample rows, or placeholders for unknown data. Unknown = `—` + freshness tag, or `stateBlock()`
- Stale keeps last-known data, tagged Stale — don't clear it
- `null`/`undefined` = "we don't know": omit from briefings/summaries, never zero it
- Capped source (page limit hit) → say "at least N" / "N+", never an exact count
- No backend yet:
  - Integrations → explicit "Not connected" card (`MyaData.INTEGRATIONS`), no dead controls
  - Metrics → omit until a real source exists
- Never load `sample-data.js` / `SAMPLE_DATA` in `future/` (test-enforced)
- All external text (DB, calls, chat) → `MyaLib.escapeHtml` before markup
