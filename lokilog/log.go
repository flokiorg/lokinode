// Package lokilog is the structured-logging front door for lokinode.
//
// It wraps log/slog with component-scoped loggers and a custom TRACE level
// (below slog.LevelDebug). The level is read once from LOKI_LOG_LEVEL at
// Init() time and applies process-wide.
package lokilog

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// LevelTrace sits below slog.LevelDebug. Use for very fine-grained events
// (per-request traces, hot-loop ticks) that should stay off by default.
const LevelTrace slog.Level = slog.LevelDebug - 4

var (
	initOnce sync.Once
	root     *slog.Logger
)

// Init configures the process-wide logger. Safe to call more than once; only
// the first call wins. Level is resolved from LOKI_LOG_LEVEL (trace/debug/
// info/warn/error), falling back to the build-time default (info in release
// builds, trace in dev builds — see default_*.go).
func Init() {
	initOnce.Do(func() {
		setupCrashLog()
		root = buildRoot(os.Stderr, resolveLevel(os.Getenv("LOKI_LOG_LEVEL")))
		slog.SetDefault(root)
	})
}

func resolveLevel(env string) slog.Level {
	if env == "" {
		return defaultLevel
	}
	return parseLevel(env)
}

func buildRoot(w io.Writer, lvl slog.Level) *slog.Logger {
	h := slog.NewTextHandler(w, &slog.HandlerOptions{
		Level: lvl,
		ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
			if a.Key == slog.LevelKey {
				if l, ok := a.Value.Any().(slog.Level); ok && l == LevelTrace {
					return slog.String(slog.LevelKey, "TRACE")
				}
			}
			return a
		},
	})
	return slog.New(h)
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "trace":
		return LevelTrace
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// For returns a logger tagged with the given component name. Use one per
// package (e.g. "daemon", "api", "wails") so logs are filterable.
func For(component string) *slog.Logger {
	if root == nil {
		Init()
	}
	return root.With("component", component)
}

// Trace logs at the custom TRACE level on the given logger.
func Trace(l *slog.Logger, msg string, args ...any) {
	l.Log(context.Background(), LevelTrace, msg, args...)
}
