//go:build unix

package lokilog

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/adrg/xdg"
	"golang.org/x/sys/unix"
)

func setupCrashLog() {
	workDir := filepath.Join(xdg.DataHome, "lokinode")
	if err := os.MkdirAll(workDir, 0755); err != nil {
		return
	}

	logFile := filepath.Join(workDir, "crash.log")
	f, err := os.OpenFile(logFile, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0644)
	if err != nil {
		return
	}

	// Write a separator and startup timestamp
	fmt.Fprintf(f, "\n--- LOKINODE STARTUP: %s ---\n", time.Now().Format(time.RFC3339))

	// Redirect stderr (FD 2) to the file.
	// This ensures that even unrecovered panics from the Go runtime go to the file.
	_ = unix.Dup2(int(f.Fd()), 2)
}
