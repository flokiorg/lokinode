# Dependency status

Audited 2026-09-10.

## Done (safe cleanups)

- **Removed stray runtime deps** `i` and `npm` from `frontend/package.json` — neither was
  imported anywhere; `npm` in particular pulled a full npm CLI into the dependency tree.
- **Aligned the Wails CLI to the library version.** `go.mod` pins
  `github.com/wailsapp/wails/v2 v2.12.0`, but CI, the `justfile`, and the README installed
  the `v2.9.3` CLI. All now install `@v2.12.0`. The CLI and library should always match —
  bindings/template generation is version-coupled.
- **Cleared 13 of 15 `govulncheck`-reachable CVEs.** Bumped `go` toolchain 1.26.5 → 1.26.6
  (fixes 6 stdlib CVEs: `net/url`, `html/template`, `crypto/tls`, `net/http`,
  `encoding/xml`, `encoding/asn1`), `google.golang.org/grpc` v1.76.0 → v1.82.1 (2 CVEs),
  `golang.org/x/net` v0.47.0 → v0.56.0 (1 CVE), `golang.org/x/text` v0.31.0 → v0.39.0
  (1 CVE), `github.com/opencontainers/runc` v1.2.8 → v1.3.6 (1 CVE), `github.com/jackc/pgx/v5`
  v5.8.0 → v5.9.2 (the pgx SQL-injection CVE — this also dropped the parallel
  `github.com/jackc/pgx/v4` finding out of govulncheck's reachable set, even though pgx v4
  itself has no upstream fix). Also bumped `github.com/docker/docker` v28.3.3 → v28.5.2
  (doesn't clear the 2 remaining CVEs — see below — but is strictly newer, so kept). Verified
  with `go build ./...`, `go vet ./...`, `go test ./...`, and a clean re-run of `govulncheck`.

## Backend (Go) — known-unfixable govulncheck findings (2 remaining)

`GO-2026-4887` / `GO-2026-4883` (Moby AuthZ plugin bypass / off-by-one privilege check) in
`github.com/docker/docker`: **`Fixed in: N/A`** even at the latest release (v28.5.2, checked
2026-09-10) — the bugs live in `dockerd`'s server-side plugin/AuthZ code, which lokinode
never runs. The module is pulled in only because `flnd`'s `lncfg` package imports
`docker/docker/api/types/{blkiodev,container,network,...}` for config-struct types at
`daemon/config.go:7`; there's no dockerd process, no Docker socket access, and no reachable
code path to the actual vulnerable behavior. Not fixable via version bump — would require
`flnd` dropping the import or a `replace` to a patched fork, neither of which exists upstream.
Re-check next audit in case Moby ships a fix.

## Backend (Go) — current, no action

`echo/v4 v4.13.3`, `gorm v1.31.1`, `zerolog v1.35.1`, `wails/v2 v2.12.0`.
`github.com/flokiorg/flnd` and `github.com/flokiorg/go-flokicoin` are intentionally pinned
chain libraries — bump them only in a deliberate, tested chain upgrade (the docker/pgx
findings above trace back to `flnd`, not to a direct lokinode dependency, so fixing them for
real means a coordinated `flnd` update, not a `go get` here). Wails v3 is a separate,
still-stabilising major; staying on v2.x is correct.

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
