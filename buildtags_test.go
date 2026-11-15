package main

import (
	_ "embed"
	"regexp"
	"strings"
	"testing"
)

// The release build scripts are embedded so this guard travels with the test
// binary and does not depend on the working directory it runs from.
//
//go:embed ops/scripts/build-ci-linux.sh
var linuxBuildScript string

//go:embed ops/scripts/build-ci-macos.sh
var macosBuildScript string

//go:embed ops/scripts/build-ci-windows.ps1
var windowsBuildScript string

// requiredReleaseBuildTags are the build tags every release build script must
// pass to `go build`/`wails build`.
//
// lokinode embeds flnd in-process (daemon/service.go runs flnd.Main), and flnd
// only compiles an RPC subserver when that subserver's build tag is set. So
// this list — not flnd — decides what the shipped node actually serves.
// signrpc is the one that bit us: release builds once omitted it, flnd then
// compiled the no-op //go:build !signrpc stub, and lokihub failed to sign its
// transport announcement with "unknown service signrpc.Signer". The dev set in
// the justfile had signrpc all along, so the release/dev divergence went
// unnoticed until it shipped.
//
// This test is the parity guard: it fails if any release script drops one of
// these tags. Add a tag here (and to the scripts) whenever a new subserver
// becomes load-bearing for a shipped build.
var requiredReleaseBuildTags = []string{
	"wails", "walletrpc", "chainrpc", "invoicesrpc",
	"routerrpc", "peersrpc", "signrpc",
}

// buildTagsArg matches a `-tags a,b,c` build argument and captures the
// comma-separated tag list (the macOS script has one per arch slice).
var buildTagsArg = regexp.MustCompile(`-tags\s+(\S+)`)

func TestReleaseBuildScriptsCarryRequiredTags(t *testing.T) {
	scripts := map[string]string{
		"ops/scripts/build-ci-linux.sh":    linuxBuildScript,
		"ops/scripts/build-ci-macos.sh":    macosBuildScript,
		"ops/scripts/build-ci-windows.ps1": windowsBuildScript,
	}

	for name, content := range scripts {
		matches := buildTagsArg.FindAllStringSubmatch(content, -1)
		if len(matches) == 0 {
			t.Errorf("%s: no `-tags` build argument found; the parity guard "+
				"can no longer see which tags this release script builds with",
				name)
			continue
		}

		for _, m := range matches {
			present := make(map[string]bool)
			for _, tag := range strings.Split(m[1], ",") {
				present[tag] = true
			}
			for _, want := range requiredReleaseBuildTags {
				if !present[want] {
					t.Errorf("%s: release build tags %q is missing %q; every "+
						"release script must keep the full set %v so the embedded "+
						"node serves every subserver dev builds with", name,
						m[1], want, requiredReleaseBuildTags)
				}
			}
		}
	}
}
