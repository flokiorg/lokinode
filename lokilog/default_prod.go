//go:build !dev

package lokilog

import "github.com/rs/zerolog"

// defaultLevel is the fallback when LOKI_LOG_LEVEL is unset. Release builds
// stay at INFO so a non-developer run produces calm, readable output.
// var defaultLevel = zerolog.InfoLevel
var defaultLevel = zerolog.TraceLevel
