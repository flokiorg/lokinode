//go:build dev

package dev

import (
	"log"
	"net/http"

	lokiapi "github.com/flokiorg/lokinode/api"
	lokiapp "github.com/flokiorg/lokinode/wails"
)

// APIPort is the loopback bind for the standalone API server during
// `wails dev`.  Bound to 127.0.0.1 (not 0.0.0.0) so the dev API is NOT
// reachable from the LAN: lock/unlock/stop/start have no auth and no CSRF
// protection, so exposing them would let anyone on the network control the
// wallet. Vite proxies /api/* to this loopback address (see vite.config.ts).
const APIPort = "127.0.0.1:9191"

// StartServer starts a plain HTTP server so Vite can proxy /api/* to it.
// The production path uses a real loopback server too (see server_prod.go).
func StartServer(app *lokiapp.App) {
	go func() {
		log.Printf("[dev] API server → http://%s", APIPort)
		if err := http.ListenAndServe(APIPort, lokiapi.NewHandler(app)); err != nil {
			log.Printf("[dev] API server error: %v", err)
		}
	}()
}

// GetPort returns the fixed loopback port used in dev mode.
func GetPort() int { return 9191 }
