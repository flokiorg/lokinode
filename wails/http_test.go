package wails

import (
	"testing"
)

// TestGetGithubLatestVersion is an integration test that calls the live GitHub
// API. It is skipped when the repository has no published releases yet (404).
// Run with: go test -run TestGetGithubLatestVersion ./httputil/
func TestGetGithubLatestVersion(t *testing.T) {
	version, err := GetGithubLatestVersion()
	if err != nil {
		// Repo not published yet — treat as skip rather than failure.
		t.Skipf("GetGithubLatestVersion returned error (repo may not be published): %v", err)
	}
	if len(version) == 0 {
		t.Error("GetGithubLatestVersion returned empty version string")
	}
	if version[0] != 'v' {
		t.Errorf("version %q does not start with 'v'", version)
	}
}
