//go:build !dev

package dev

import (
	"net"
	"net/http"

	lokiapi "github.com/flokiorg/lokinode/api"
	lokiapp "github.com/flokiorg/lokinode/wails"
)

var apiPort int

// StartServer binds a loopback HTTP server on a random port so that the
// frontend can reach /api/* over a real net/http connection.  This is
// necessary because Wails' AssetServer uses WKURLSchemeHandler on macOS,
// which cannot stream long-lived SSE responses.
func StartServer(app *lokiapp.App) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return
	}
	apiPort = ln.Addr().(*net.TCPAddr).Port
	go http.Serve(ln, lokiapi.NewHandler(app)) //nolint:errcheck
}

// GetPort returns the loopback port the API server is listening on.
func GetPort() int { return apiPort }
