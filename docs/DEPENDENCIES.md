# Dependency status

Audited 2026-09-10.

## Done (safe cleanups)

- **Removed stray runtime deps** `i` and `npm` from `frontend/package.json` — neither was
  imported anywhere; `npm` in particular pulled a full npm CLI into the dependency tree.
- **Aligned the Wails CLI to the library version.** `go.mod` pins
  `github.com/wailsapp/wails/v2 v2.12.0`, but CI, the `justfile`, and the README installed
  the `v2.9.3` CLI. All now install `@v2.12.0`. The CLI and library should always match —
  bindings/template generation is version-coupled.

## Backend (Go) — current, no action

`go 1.26.5`, `grpc v1.76.0`, `echo/v4 v4.13.3`, `gorm v1.31.1`, `zerolog v1.35.1`,
`wails/v2 v2.12.0`. `github.com/flokiorg/flnd` and `github.com/flokiorg/go-flokicoin` are
intentionally pinned chain libraries — bump them only in a deliberate, tested chain
upgrade. Wails v3 is a separate, still-stabilising major; staying on v2.x is correct.

## Frontend — major upgrades to schedule (one PR each)

Run `pnpm run build` + `pnpm test` + a manual smoke run (`just dev`, start a node, open
each tab, open the Logs overlay) after each.

| Package | Current | Target | Notes / risk |
|---|---|---|---|
| `vite` | 3.2.11 | latest 7.x | ~3 years behind. Needs a matching `@vitejs/plugin-react`. Check `vite.config.ts`, `base`, env-var prefixing, and the Wails `frontend:dev:serverUrl: auto` handshake. |
| `@vitejs/plugin-react` | 2.2.0 | matches Vite | upgrade together with Vite. |
| `typescript` | 4.9.5 | 5.x | new `tsc` checks may surface type errors; review `moduleResolution` / `verbatimModuleSyntax`. |
| `vitest` | 1.6.1 | 3.x | coupled to the Vite/Vitest version; config + mock API deltas. Check `vitest.config.ts`. |
| `zustand` | 4.5.5 | 5.x | v5 drops the deprecated default export and tightens middleware types; `persist` + `partialize` are used in `store/nodeConfig.ts` and plain `create` in `store/nodeSession.ts` — verify both compile and that `loki_node_config_v3` still rehydrates. |

Lower priority / keep an eye on: `react` 18 → 19 (only after the above land; `react-router`
7 already supports 19), `framer-motion` (now `motion`), `@types/node` to match the CI Node
version.
