// Package lokilog is the structured-logging front door for lokinode.
//
// It wraps zerolog with component-scoped loggers. The level is read once from
// LOKI_LOG_LEVEL at Init() time and applies process-wide.
// Supported levels: trace, debug, info, warn, error.
package lokilog

import (
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

var (
	initOnce sync.Once
	root     zerolog.Logger
)

// Init configures the process-wide logger. Safe to call more than once; only
// the first call wins. Level is resolved from LOKI_LOG_LEVEL (trace/debug/
// info/warn/error), falling back to the build-time default (info in release
// builds, trace in dev builds — see default_*.go).
func Init() {
	initOnce.Do(func() {
		setupCrashLog()
		root = buildRoot(os.Stderr, resolveLevel(os.Getenv("LOKI_LOG_LEVEL")))
	})
}

func buildRoot(w io.Writer, lvl zerolog.Level) zerolog.Logger {
	cw := zerolog.ConsoleWriter{
		Out:        w,
		TimeFormat: time.RFC3339,
	}
	return zerolog.New(cw).Level(lvl).With().Timestamp().Logger()
}

func resolveLevel(env string) zerolog.Level {
	if env == "" {
		return defaultLevel
	}
	return parseLevel(env)
}

func parseLevel(s string) zerolog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "trace":
		return zerolog.TraceLevel
	case "debug":
		return zerolog.DebugLevel
	case "warn", "warning":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	default:
		return zerolog.InfoLevel
	}
}

// For returns a logger tagged with the given component name. Use one per
// package (e.g. "daemon", "api", "wails") so logs are filterable.
func For(component string) zerolog.Logger {
	initOnce.Do(func() {
		setupCrashLog()
		root = buildRoot(os.Stderr, resolveLevel(os.Getenv("LOKI_LOG_LEVEL")))
	})
	return root.With().Str("component", component).Logger()
}
