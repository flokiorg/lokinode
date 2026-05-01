//go:build dev

package lokilog

// defaultLevel is the fallback when LOKI_LOG_LEVEL is unset. Dev builds
// default to TRACE so every lifecycle/health/handler event is visible in
// `wails dev` logs without needing an env var.
var defaultLevel = LevelTrace
