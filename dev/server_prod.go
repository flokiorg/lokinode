//go:build !dev

package dev

import (
	"context"
	"net"
	"net/http"
	"time"

	lokiapi "github.com/flokiorg/lokinode/api"
	lokiapp "github.com/flokiorg/lokinode/wails"
)

var apiPort int

// StartServer binds a loopback HTTP server on a random port so that the
// frontend can reach /api/* over a real net/http connection.  This is
// necessary because Wails' AssetServer uses WKURLSchemeHandler on macOS,
// which cannot stream long-lived SSE responses.
func StartServer(app *lokiapp.App) {
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp4", "127.0.0.1:0")
	if err != nil {
		return
	}
	apiPort = ln.Addr().(*net.TCPAddr).Port
	srv := &http.Server{
		Handler: lokiapi.NewHandler(app),
		// No ReadTimeout/WriteTimeout: /api/logs/stream is a long-lived SSE
		// connection that must not be capped. ReadHeaderTimeout alone still
		// guards against slow-header connections.
		ReadHeaderTimeout: 5 * time.Second,
	}
	go srv.Serve(ln) //nolint:errcheck
}

// GetPort returns the loopback port the API server is listening on.
func GetPort() int { return apiPort }
