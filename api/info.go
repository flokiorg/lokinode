package api

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/flokiorg/flnd/lnrpc"
	"github.com/labstack/echo/v4"
	"github.com/flokiorg/lokinode/daemon"
	lokiwails "github.com/flokiorg/lokinode/wails"
	"google.golang.org/grpc/status"
)

// H4: cache GitHub version and mempool height so they are not fetched on
// every 2-second poll from useInfo(true).

var versionCache struct {
	mu        sync.Mutex
	value     string
	fetchedAt time.Time
}

var mempoolCache struct {
	mu        sync.Mutex
	value     int64
	fetchedAt time.Time
}

const versionCacheTTL = 60 * time.Minute
const mempoolCacheTTL = 30 * time.Second

func cachedLatestVersion() string {
	versionCache.mu.Lock()
	if time.Since(versionCache.fetchedAt) < versionCacheTTL {
		v := versionCache.value
		versionCache.mu.Unlock()
		return v
	}
	versionCache.mu.Unlock()

	// Fetch outside the lock so concurrent callers are not blocked.
	v, err := lokiwails.GetGithubLatestVersion()

	versionCache.mu.Lock()
	defer versionCache.mu.Unlock()
	if err == nil && v != "" {
		versionCache.value = v
		versionCache.fetchedAt = time.Now()
	}
	return versionCache.value
}

func cachedMempoolHeight(explorerHost string) int64 {
	mempoolCache.mu.Lock()
	if time.Since(mempoolCache.fetchedAt) < mempoolCacheTTL {
		h := mempoolCache.value
		mempoolCache.mu.Unlock()
		return h
	}
	mempoolCache.mu.Unlock()

	// Fetch outside the lock so concurrent callers are not blocked.
	h, err := lokiwails.GetBlocksTipHeight(explorerHost)

	mempoolCache.mu.Lock()
	defer mempoolCache.mu.Unlock()
	if err == nil {
		mempoolCache.value = h
		mempoolCache.fetchedAt = time.Now()
	}
	return mempoolCache.value
}

func handleInfo(app App) echo.HandlerFunc {
	return func(c echo.Context) error {
		resp := InfoResponse{
			Version:         app.GetVersion(),
			LatestVersion:   cachedLatestVersion(),
			AnotherInstance: app.IsAnotherInstanceRunning(),
		}

		svc := app.Service()
		if svc == nil {
			resp.State = "stopped"
			return c.JSON(http.StatusOK, resp)
		}

		resp.NodeRunning = true

		// Wallet state — read first (no I/O, always current).
		// subscribeState() keeps this updated asynchronously.
		if ev := svc.GetLastEvent(); ev != nil {
			resp.State = string(ev.State)
			if ev.Err != nil {
				resp.Error = ev.Err.Error()
			}
			resp.PortConflict = ev.PortConflict
		}

		// Defensive fallback: when the subscription is still reporting "starting"
		// or "init" but flnd is already in a more advanced state, query it
		// directly so the UI reflects reality without waiting for the async
		// subscription to catch up (e.g. after a stream reconnect that skipped
		// the UNLOCKED event).
		if resp.State == string(daemon.StatusStarting) || resp.State == string(daemon.StatusInit) {
			if stateResp, err := svc.GetState(); err == nil {
				switch stateResp.State {
				case lnrpc.WalletState_LOCKED:
					resp.State = string(daemon.StatusLocked)
				case lnrpc.WalletState_NON_EXISTING:
					resp.State = string(daemon.StatusNoWallet)
				case lnrpc.WalletState_UNLOCKED:
					resp.State = string(daemon.StatusUnlocked)
				case lnrpc.WalletState_RPC_ACTIVE, lnrpc.WalletState_SERVER_ACTIVE:
					resp.State = string(daemon.StatusSyncing)
				}
			}
		}

		// GetInfo and GetLightningConfig require an unlocked wallet.
		// Skip them when locked/starting to avoid spamming FLND error logs.
		walletReady := resp.State == string(daemon.StatusReady) ||
			resp.State == string(daemon.StatusSyncing) ||
			resp.State == string(daemon.StatusScanning) ||
			resp.State == string(daemon.StatusBlock) ||
			resp.State == string(daemon.StatusTransaction)

		if walletReady {
			// Node info via gRPC (fast — local IPC)
			info, err := svc.GetInfo()
			if err == nil {
				resp.SyncedToChain = info.SyncedToChain
				resp.BlockHeight = info.BlockHeight
				resp.BestHeaderTimestamp = info.BestHeaderTimestamp
				resp.NodePubkey = info.IdentityPubkey
				resp.NodeAlias = info.Alias
				if len(info.Chains) > 0 {
					resp.Network = info.Chains[0].Network
				}
				// If the subscription is still reporting "syncing" but flnd
				// confirms the chain is synced, promote to ready immediately
				// rather than waiting for the next polling tick.
				if resp.State == string(daemon.StatusSyncing) && info.SyncedToChain {
					resp.State = string(daemon.StatusReady)
				}
				// Uris holds the addresses the node actually announces to the network
				// (e.g. ["02abc...@1.2.3.4:5521"]). Use these to report what the
				// daemon is really doing — the configured RawExternalIPs value may
				// not yet reflect a UPnP-discovered address or NAT translation.
				if len(info.Uris) > 0 {
					resp.NodePublic = true
					if addr := extractHostPort(info.Uris[0]); addr != "" {
						resp.ExternalIP = addr
					}
				}
			}

			// Credentials and network addresses — cheap path: reuses the
			// GetInfo response above, reads the cached TLS cert hex, and
			// skips the redundant second GetInfo call that the full
			// GetLightningConfig would perform on every 2s poll.
			if conn, err := svc.GetConnectionInfo(); err == nil {
				resp.PeerAddress = conn.PeerAddress
				resp.RpcAddress = conn.RpcAddress
				resp.MacaroonHex = conn.MacaroonHex
				resp.TLSCertHex = conn.TLSCertHex
			}
		}

		// Config-derived fields (filesystem paths — served only to local WebView)
		cfg := app.Config()
		if cfg != nil {
			resp.NodeDir = cfg.LndDir
			resp.MacaroonPath = cfg.AdminMacPath
			resp.TLSCertPath = cfg.TLSCertPath

			// Current configuration state (to detect dirty state).
			// gRPC-derived values (from GetInfo.Uris) take precedence when
			// available — they reflect what the daemon is actually announcing.
			// Fall back to the in-memory config for each field independently.
			if resp.NodeAlias == "" {
				resp.NodeAlias = cfg.Alias
			}
			if !resp.NodePublic {
				resp.NodePublic = !cfg.DisableListen
			}
			if resp.ExternalIP == "" && len(cfg.RawExternalIPs) > 0 {
				resp.ExternalIP = cfg.RawExternalIPs[0]
			}
			resp.RestCors = strings.Join(cfg.RestCORS, ",")

			if len(cfg.RESTListeners) > 0 {
				prefix := "http://"
				if !cfg.DisableRestTLS {
					prefix = "https://"
				}
				resp.RESTEndpoint = prefix + cfg.RESTListeners[0].String()
			}
		}

		// Mempool tip height (cached — avoids hitting explorer on every 2s poll)
		resp.MempoolHeight = cachedMempoolHeight(app.ExplorerHost())

		return c.JSON(http.StatusOK, resp)
	}
}

// extractHostPort parses a flnd node URI of the form "pubkey@host:port"
// and returns the "host:port" portion, or "" if the URI is malformed.
func extractHostPort(uri string) string {
	if idx := strings.Index(uri, "@"); idx >= 0 {
		return uri[idx+1:]
	}
	return ""
}

// apiErr writes a JSON error body and returns the error for the caller to return.
func apiErr(c echo.Context, status int, err error) error {
	msg := "unknown error"
	if err != nil {
		msg = err.Error()
	}
	return c.JSON(status, ErrorResponse{Message: msg})
}

// svcErr writes a 503 when the node is not running.
func svcErr(c echo.Context) error {
	return apiErr(c, http.StatusServiceUnavailable, errors.New("node not running"))
}

// sanitizeGRPC extracts the human-readable description from a gRPC error,
// falling back to a generic message.  This prevents raw gRPC metadata
// (codes, internal paths) from leaking to the client.
func sanitizeGRPC(err error) error {
	if err == nil {
		return nil
	}
	// Pass through known internal errors
	if errors.Is(err, daemon.ErrWalletMustBeLocked) || errors.Is(err, daemon.ErrDaemonNotRunning) {
		return err
	}
	if s, ok := status.FromError(err); ok {
		return errors.New(s.Message())
	}
	return errors.New("operation failed")
}
