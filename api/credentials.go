package api

import (
	"encoding/hex"
	"net/http"
	"os"

	"github.com/labstack/echo/v4"
	"github.com/flokiorg/lokinode/daemon"
)

// handleCredentials returns the macaroon and TLS certificate paths always,
// but only includes the hex-encoded credential bytes once the wallet is
// unlocked — the macaroon file does not exist on disk until then.
func handleCredentials(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		cfg := app.Config()
		if cfg == nil {
			return svcErr(c)
		}

		resp := CredentialsResponse{
			MacaroonPath: cfg.AdminMacPath,
			TLSCertPath:  cfg.TLSCertPath,
		}

		// Populate hex values only when the wallet is unlocked and the
		// macaroon has been written to disk by the daemon.
		svc := app.Service()
		if svc != nil {
			if ev := svc.GetLastEvent(); ev != nil {
				switch ev.State {
				case daemon.StatusUnlocked, daemon.StatusSyncing, daemon.StatusReady,
					daemon.StatusScanning, daemon.StatusBlock, daemon.StatusTransaction:
					if raw, err := os.ReadFile(cfg.AdminMacPath); err == nil {
						resp.MacaroonHex = hex.EncodeToString(raw)
					}
					if raw, err := os.ReadFile(cfg.TLSCertPath); err == nil {
						resp.TLSCertHex = hex.EncodeToString(raw)
					}
				}
			}
		}

		// Prefer resolved listeners; fall back to raw config strings.
		if len(cfg.RPCListeners) > 0 {
			resp.GRPCEndpoint = cfg.RPCListeners[0].String()
		} else if len(cfg.RawRPCListeners) > 0 {
			resp.GRPCEndpoint = cfg.RawRPCListeners[0]
		}

		return c.JSON(http.StatusOK, resp)
	}
}
