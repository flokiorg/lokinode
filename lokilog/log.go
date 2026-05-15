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
		root = buildRoot(resolveLevel(os.Getenv("LOKI_LOG_LEVEL")))
	})
}

func buildRoot(lvl zerolog.Level) zerolog.Logger {
	var writers []io.Writer
	writers = append(writers, zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})
	if f := openLokinodeLog(); f != nil {
		writers = append(writers, zerolog.ConsoleWriter{Out: f, TimeFormat: time.RFC3339, NoColor: true})
	}
	return zerolog.New(io.MultiWriter(writers...)).Level(lvl).With().Timestamp().Logger()
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
		root = buildRoot(resolveLevel(os.Getenv("LOKI_LOG_LEVEL")))
	})
	return root.With().Str("component", component).Logger()
}
