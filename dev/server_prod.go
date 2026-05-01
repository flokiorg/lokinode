//go:build !dev

package dev

import lokiapp "github.com/flokiorg/lokinode/wails"

// StartServer is a no-op in production builds.
// The AssetServer.Handler in lokinode.go handles all /api/* requests.
func StartServer(_ *lokiapp.App) {}
