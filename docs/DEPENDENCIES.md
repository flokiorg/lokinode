# Dependency status

Audited 2026-09-10.

## Done (safe cleanups)

- **Removed stray runtime deps** `i` and `npm` from `frontend/package.json` — neither was
  imported anywhere; `npm` in particular pulled a full npm CLI into the dependency tree.
- **Aligned the Wails CLI to the library version.** `go.mod` pins
  `github.com/wailsapp/wails/v2 v2.12.0`, but CI, the `justfile`, and the README installed
  the `v2.9.3` CLI. All now install `@v2.12.0`. The CLI and library should always match —
  bindings/template generation is version-coupled.
- **Cleared 11 of 15 `govulncheck`-reachable CVEs**, and made the `security-go` CI job
  blocking instead of `continue-on-error: true`, with the 4 remaining findings tracked in
  `.github/govulncheck-allowlist.txt` (CI fails on anything reachable that isn't listed
  there). Bumped `go` toolchain 1.26.5 → 1.26.6 (fixes 6 stdlib CVEs: `net/url`,
  `html/template`, `crypto/tls`, `net/http`, `encoding/xml`, `encoding/asn1`),
  `google.golang.org/grpc` v1.76.0 → v1.82.1 (2 CVEs), `golang.org/x/net` v0.47.0 → v0.56.0
  (1 CVE), `golang.org/x/text` v0.31.0 → v0.39.0 (1 CVE), `github.com/opencontainers/runc`
  v1.2.8 → v1.3.6 (1 CVE), `github.com/jackc/pgx/v5` v5.8.0 → v5.9.2 (1 CVE — pgx v4 has the
  same underlying CVE but no fix; see below). Also bumped `github.com/docker/docker` v28.3.3
  → v28.5.2 (doesn't clear its 2 CVEs below, but is strictly newer, so kept). Verified with
  `go build ./...`, `go vet ./...`, `go test ./...`, and a clean re-run of `govulncheck`.
- **Fixed all 18 `gosec` findings** by adding `#nosec Gxxx -- reason` directives alongside
  the pre-existing `//nolint:gosec` ones. The standalone `gosec` binary (run directly in CI,
  not through golangci-lint) doesn't understand `//nolint:`, so the `security-go` job's gosec
  step had 18 real findings it never even reported — the job failed at the govulncheck step
  first, every time, so gosec silently never ran. `gosec ./...` now reports 0 issues.

  > **Gotcha for local testing:** if you run Go commands for this repo from inside a checkout
  > that sits under a sibling `go.work` (a multi-repo workspace file, e.g. one that also
  > `use`s a local `../flnd` checkout), Go transparently resolves `github.com/flokiorg/flnd`
  > et al. against those *local* sibling checkouts instead of the versions pinned in this
  > repo's `go.mod`/`go.sum`. `govulncheck`'s reachability results in particular will disagree
  > with CI's fresh, workspace-free checkout. Always verify with `GOWORK=off` (or from outside
  > the workspace) before trusting a local `govulncheck`/`go build` result against this repo.

## Backend (Go) — known-unfixable govulncheck findings (4, allow-listed in CI)

All four have **`Fixed in: N/A`** upstream (checked 2026-09-10) and are unreachable in
practice — they're pulled in transitively via `flnd`, not by anything lokinode itself calls.
Full reasoning lives in `.github/govulncheck-allowlist.txt`, which CI checks against; summary:

- `GO-2026-4887` / `GO-2026-4883` (Moby AuthZ plugin bypass / off-by-one privilege check) in
  `github.com/docker/docker` — the bugs live in `dockerd`'s server-side plugin/AuthZ code,
  which lokinode never runs. Pulled in because `flnd`'s `lncfg` package imports
  `docker/docker/api/types/{blkiodev,container,network,...}` for config-struct types
  (`daemon/config.go:7`); there's no dockerd process or Docker socket access anywhere in
  lokinode.
- `GO-2026-5004` (SQL injection via dollar-quoted string placeholder confusion) in
  `github.com/jackc/pgx/v4` — `go mod why github.com/jackc/pgx/v4/stdlib` shows it's pulled
  in by `flnd`'s own optional Postgres channel-DB backend (`flnd/kvdb/sqlbase`). lokinode's
  own `db/db.go` only ever opens `gorm.io/driver/sqlite`.
- `GO-2026-4518` (denial of service) in `github.com/jackc/pgproto3/v2` — pgx v4's wire
  protocol layer; same unreachable-at-runtime path as `GO-2026-5004` above.

Re-check next audit (`GOWORK=off go run golang.org/x/vuln/cmd/govulncheck@latest ./...`, see
the gotcha above) in case any of these ship a fix, and remove the corresponding line from
`.github/govulncheck-allowlist.txt` if so.

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
