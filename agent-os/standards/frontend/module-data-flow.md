# Module & Data Flow (command-center/future/)

No build step (Phase 1; may move to a framework later).

- Each file = ES5 IIFE exposing one `window.Mya*` global. No `import`, `const`/`let`, arrows, or bundler
- Load order (index.html): lib → mya-events → core → data → chat → views → shell → app
- `lib.js`: pure, DOM/network-free, UMD. Put decision logic here; test in `tests/command-center/` (`node --test`)
- Views never `fetch()`. Add a source to `MyaData.SOURCES` (existing `/api/*` endpoint), read via `MyaData.get/freshness`, re-render on `MyaEvents` `"data.changed"`
- After Mya tool calls, map tool → sources in `TOOL_SOURCES`
- Cross-module signals go through `MyaEvents` (namespaced: `mya.*`, `data.*`, `auth.*`, `chat.*`)
- Changing any shell asset: bump `?v=N` in index.html AND `SHELL_ASSETS` + `CACHE_VERSION` in sw.js together
