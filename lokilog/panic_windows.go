//go:build windows

package lokilog

func setupCrashLog() {
	// Stderr redirection on Windows requires different syscalls (SetStdHandle).
	// For now we leave it as a no-op to avoid complexity, as the primary 
	// target for this feature is macOS debugging.
}
