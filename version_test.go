package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

var changelogHeading = regexp.MustCompile(`(?m)^## \[([^\]]+)\]`)

// TestVersionMatchesChangelog keeps the embedded VERSION and CHANGELOG.md in
// agreement.
//
// VERSION is the build-time input: it is go:embed-ed into the binary and
// wails/http_test.go asserts the reported version keeps its "v" prefix.
// CHANGELOG.md is where the release notes come from. The release workflow
// refuses to publish when the two disagree, and this test catches it earlier,
// on the pull request that bumped only one of them.
func TestVersionMatchesChangelog(t *testing.T) {
	data, err := os.ReadFile("CHANGELOG.md")
	if err != nil {
		t.Fatalf("reading CHANGELOG.md: %v", err)
	}

	m := changelogHeading.FindSubmatch(data)
	if m == nil {
		t.Fatal("no '## [version]' heading found in CHANGELOG.md")
	}

	top := string(m[1])
	if got := strings.TrimSpace(appVersion); got != top {
		t.Errorf("VERSION is %q but the topmost CHANGELOG.md heading is %q; "+
			"bump both together", got, top)
	}
}
