# Contributing to Lokinode

## Building and testing

The Go packages embed `frontend/dist`, so the frontend has to be built before
the Go build or test will compile:

```sh
cd frontend && pnpm install && pnpm build && cd ..
go build ./...
go vet ./...
go test ./...
```

CI does this as a separate `Build frontend (dist)` job whose artifact the Go
jobs download, which is why a bare `go test ./...` fails on a clean checkout
with `pattern all:frontend/dist: no matching files found`.

Desktop builds go through the scripts in `ops/`; see `.github/workflows/`.

## Pull requests

- Keep each change focused; split unrelated work into separate pull requests.
- Add a `CHANGELOG.md` entry for anything that changes behaviour, under the
  topmost `## [vX.Y.Z]` heading. If the last release just shipped and no
  heading is open yet, add one with the version the change warrants and bump
  `VERSION` to match.
- Once your pull request has a number, append `(#N)` to the changelog bullets it
  introduces. The release notes are generated from that text.

## Versioning

Two files have to agree, and `TestVersionMatchesChangelog` fails if they do not:

- **`VERSION`** is the build-time input. It is `go:embed`-ed into the binary, and
  `wails/http_test.go` asserts the reported version keeps its `v` prefix — so
  this repo's versions and tags are `v`-prefixed (`v0.1.7-rc4`), unlike the Go
  daemons in this org.
- **`CHANGELOG.md`**'s topmost `## [vX.Y.Z]` heading must be the same string,
  and its body is published as the release notes.

`wails.json`'s `productVersion` is deliberately *not* kept in step: it is native
OS packaging metadata, not the release tag (see the comment in `wails/app.go`).

## How releases are cut

One manual dispatch. `release.yaml` builds **and** publishes in the same run, so
there is no separate build step to run first.

```sh
gh workflow run release.yaml --repo flokiorg/lokinode               # Linux only
gh workflow run release.yaml --repo flokiorg/lokinode -f include_windows=true
gh workflow run release.yaml --repo flokiorg/lokinode -f include_macos=true
gh workflow run release.yaml --repo flokiorg/lokinode -f dry_run=true   # build, publish nothing
```

Lean by default: with no flags it builds and publishes only the Linux desktop
packages (`.deb`/`.rpm`/`.AppImage`, amd64+arm64), which is what every rc
actually needs. Extras are opt-in per release:

- `include_windows` adds the Windows desktop build.
- `include_macos` builds the `.dmg` on Codemagic (GitHub-hosted macOS runners
  are capacity-unreliable) and attaches it. This needs the `CODEMAGIC_API_TOKEN`
  and `CODEMAGIC_APP_ID` repo secrets — see `codemagic.yaml` for the one-time
  setup. Without them the macOS job fails fast.
- `dry_run` builds the selected platforms but publishes nothing.

Linux is always required; an opted-in platform that fails blocks the release,
and one you didn't opt into is simply absent. Because build and publish share
one run, the binaries, tag, and notes are one commit by construction — the old
`build-all.yaml` harvest-a-separate-run flow (and its staleness guard) is gone.

It reads the notes from `CHANGELOG.md` — whose topmost `## [vX.Y.Z]` heading must
match `VERSION` — and creates the release via `softprops/action-gh-release`,
which updates the release in place if one already exists for the tag. A version
containing a hyphen is published as a prerelease.

Do not create the tag by hand — the workflow creates it from `VERSION`.
