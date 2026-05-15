//go:build windows

package lokilog

import (
	"os"
	"path/filepath"
)

func appDataDir() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "lokinode")
}

func setupCrashLog() {
	// Stderr redirection on Windows requires different syscalls (SetStdHandle).
	// For now we leave it as a no-op to avoid complexity, as the primary
	// target for this feature is macOS debugging.
}

func openLokinodeLog() *os.File {
	workDir := appDataDir()
	if workDir == "" {
		return nil
	}
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return nil
	}
	f, err := os.OpenFile(filepath.Join(workDir, "lokinode.log"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0644)
	if err != nil {
		return nil
	}
	return f
}
