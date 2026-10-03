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
- **2026-09-16: bumped `google.golang.org/grpc` v1.82.1 → v1.83.2** (clears newly-published
  `GO-2026-6348` and `GO-2026-6443`, both reachable via `daemon`'s own `ClientConn`
  lifecycle code, not just a transitive import). `go mod tidy` pulled in matching transitive
  bumps (`golang.org/x/net`, `x/sys`, `x/text`, `otel`, `genproto`). Verified with
  `GOWORK=off go build/vet/test ./daemon/... ./api/... ./wails/...` (race included) and a
  clean re-run of `govulncheck` (see the gotcha above — run it `GOWORK=off`).
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

## Backend (Go) — govulncheck findings: none

As of 2026-10-03 `govulncheck ./...` reports **no reachable findings**, and
`.github/govulncheck-allowlist.txt` is empty.

Four findings used to be allow-listed here: `GO-2026-4887` / `GO-2026-4883`
(`github.com/docker/docker`) and `GO-2026-5004` / `GO-2026-4518`
(`github.com/jackc/pgx/v4` and its wire layer). All four were accepted on the
grounds that upstream reported `Fixed in: N/A`. The dependency updates in
v0.1.8-rc1 -- go-flokicoin to 0.26.3, flnd to 0.2.4, and the transitive bumps
that came with them -- made every one of them unreachable, so the entries were
removed.

Note `docker/docker` is still *in* the module graph here, reached via
`golang-migrate/migrate/v4/database/pgx/v5` -> `dhui/dktest`. Bumping
`docker/cli` to 29.x does **not** remove it, which is what worked in `flnd` and
`lokihub` where the only path ran through `docker/cli`. It does not need
removing: nothing reachable depends on it.

Re-check with `GOWORK=off go run golang.org/x/vuln/cmd/govulncheck@latest ./...`
after building `frontend/dist`, which the Go packages embed.


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
