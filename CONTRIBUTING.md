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

Two manual dispatches, in order:

```sh
gh workflow run build-all.yaml --repo flokiorg/lokinode   # builds the artifacts
gh workflow run release.yaml   --repo flokiorg/lokinode   # tags and publishes
```

`release.yaml` does not build. It harvests the artifacts from the most recent
successful `build-all.yaml` run, so **build-all has to run first, after the
version bump has landed**. The workflow now checks that every downloaded
artifact carries the version in its filename and fails if they do not, which is
what catches a stale build-all run rather than publishing it silently.

It then reads the notes from `CHANGELOG.md`, deletes any existing tag and
release for that version so a re-dispatch republishes cleanly, and creates the
release. A version containing a hyphen is published as a prerelease.

Do not create the tag by hand — the workflow creates it from `VERSION`.
