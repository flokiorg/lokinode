//go:build !dev

package lokilog

import "log/slog"

// defaultLevel is the fallback when LOKI_LOG_LEVEL is unset. Release builds
// stay at INFO so a non-developer run produces calm, readable output.
var defaultLevel slog.Level = slog.LevelInfo
