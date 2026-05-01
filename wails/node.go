package wails

import (
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/flnd/signal"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/db"
	"github.com/flokiorg/lokinode/lokilog"
)

var log *slog.Logger = lokilog.For("wails")

// VerifyConfig validates the user-supplied node config and stores the result
// for RunNode. It delegates entirely to the daemon package which builds the
// complete flnd.Config from struct fields — no INI parsing on the hot path.
func (a *App) VerifyConfig(ucfg daemon.UserNodeConfig) error {
	ucfg.Dir = filepath.Clean(ucfg.Dir)
	// signal.Intercept() is a process-level singleton. There is a tiny window
	// between a previous interceptor's ShutdownChannel closing and the handler
	// goroutine resetting the global "started" flag. Retry on that specific
	// error (same approach as service.run) rather than surfacing it to the user.
	var interceptor signal.Interceptor
	var err error
	interceptor, err = signal.Intercept()
	if err != nil && !strings.Contains(err.Error(), "already started") {
		return err
	}

	// If we successfully intercepted, we must clean up. If it was already
	// started, we assume the running daemon owns it and we don't touch it.
	if err == nil {
		defer func() {
			interceptor.RequestShutdown()
			<-interceptor.ShutdownChannel()
		}()
	}

	cfg, err := daemon.BuildAndValidate(interceptor, ucfg)
	if err != nil {
		return err
	}
	a.flndCfg = cfg
	return nil
}

// nodeToConfig converts a DB node record to a UserNodeConfig.
func nodeToConfig(node db.Node) daemon.UserNodeConfig {
	return daemon.UserNodeConfig{
		PubKey:     node.PubKey,
		Dir:        node.Dir,
		Alias:      node.Alias,
		NodePublic: node.NodePublic,
		ExternalIP: node.ExternalIP,
		RestCors:   node.RestCors,
		RPCListen:  node.RpcListen,
		RESTListen: node.RestListen,
	}
}

// GetNodeConfig loads the persistent user configuration from a node directory.
// The Lokinode DB is the single source of truth for all user-managed settings.
// Primary lookup is by directory. If that misses (e.g. the node directory was
// moved and the DB record was migrated to the new path before restart), a
// secondary lookup by the running node's pubkey is attempted via GetInfo.
func (a *App) GetNodeConfig(dir string) (daemon.UserNodeConfig, error) {
	dir = filepath.Clean(dir)
	if a.db != nil {
		var node db.Node
		if err := a.db.First(&node, "dir = ?", dir).Error; err == nil {
			return nodeToConfig(node), nil
		}
		// Dir lookup missed — fall back to the running node's pubkey so that
		// RestartNode() continues to use the correct settings after a dir migration.
		if a.nodeService != nil {
			if info, err := a.nodeService.GetInfo(); err == nil && info.IdentityPubkey != "" {
				if err := a.db.First(&node, "pub_key = ?", info.IdentityPubkey).Error; err == nil {
					return nodeToConfig(node), nil
				}
			}
		}
	}
	return daemon.UserNodeConfig{Dir: dir}, nil
}

// GetDefaultNodeDir returns the platform-default FLND data directory.
func (a *App) GetDefaultNodeDir() string {
	return flnd.DefaultLndDir
}

// IsDirEmpty reports whether path does not exist yet or is an empty directory.
func (a *App) IsDirEmpty(path string) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return true, nil
		}
		return false, err
	}
	defer f.Close()

	names, err := f.Readdirnames(-1)
	if err != nil {
		return false, err
	}

	for _, name := range names {
		ln := strings.ToLower(name)
		// Ignore all hidden files (starting with dot) and OS metadata junk
		if strings.HasPrefix(name, ".") || ln == "desktop.ini" || ln == "thumbs.db" || ln == "__macosx" {
			continue
		}
		// If we find any visible file or directory, it's not empty
		return false, nil
	}
	return true, nil
}

// RunNode starts the FLND daemon using the last validated config. Calling
// RunNode before VerifyConfig returns an error.
//
// Idempotent: if a service is already attached, RunNode is a no-op. This
// prevents rapid double-clicks from creating overlapping services that race
// on the process-singleton signal.Intercept. To replace a running daemon
// call StopNode() first, then RunNode().
func (a *App) RunNode() error {
	if a.flndCfg == nil {
		log.Warn("RunNode called without a validated config")
		return errNoProfile
	}

	a.nodeServiceMu.Lock()
	if a.nodeService != nil {
		a.nodeServiceMu.Unlock()
		log.Debug("RunNode noop (service already attached)")
		return nil
	}
	a.nodeService = daemon.New(a.ctx, a.flndCfg)
	a.nodeServiceMu.Unlock()
	log.Info("RunNode: service created")
	return nil
}

// CheckNodeDir reports whether dir contains an existing flnd node by looking
// for the TLS certificate that flnd generates on its first start, and/or the
// mainnet wallet database.  This lets the frontend skip the alias/config form
// and instead offer a one-click "start existing node" flow.
func (a *App) CheckNodeDir(dir string) bool {
	if dir == "" {
		return false
	}
	// tls.cert is created by flnd on first startup — most reliable indicator.
	if _, err := os.Stat(filepath.Join(dir, "tls.cert")); err == nil {
		return true
	}
	// Fallback: check for the mainnet wallet database.
	walletDB := filepath.Join(dir, "data", "chain", "flokicoin", "main", "wallet.db")
	_, err := os.Stat(walletDB)
	return err == nil
}

// StopNode shuts down the running daemon.
func (a *App) StopNode() {
	a.nodeServiceMu.Lock()
	svc := a.nodeService
	a.nodeService = nil
	a.nodeServiceMu.Unlock()

	if svc != nil {
		log.Info("StopNode: stopping attached service")
		svc.Stop()
	} else {
		log.Debug("StopNode noop (no attached service)")
	}
}

// RestartNode bounces the daemon in-place without tearing down the service.
// Used for lock: matches twallet's single-call pattern (service stays alive,
// subscriber channels stay connected, no signal.Intercept recreation race).
// Returns daemon.ErrDaemonNotRunning if the service exists but the daemon
// hasn't been registered yet — the UI should wait, not retry.
func (a *App) RestartNode() error {
	a.nodeServiceMu.Lock()
	svc := a.nodeService
	a.nodeServiceMu.Unlock()

	if svc == nil {
		log.Warn("RestartNode called but no service attached")
		return daemon.ErrDaemonNotRunning
	}

	// Re-load the config from disk and validate it again so the restart uses
	// the latest user settings (Alias, Public IP, CORS, etc).
	ucfg, err := a.GetNodeConfig(a.flndCfg.LndDir)
	if err != nil {
		return err
	}
	// We need an interceptor for BuildAndValidate. Since the node is already 
	// running, signal.Intercept() will return "already started".
	interceptor, _ := signal.Intercept()
	cfg, err := daemon.BuildAndValidate(interceptor, ucfg)
	if err != nil {
		return err
	}
	a.flndCfg = cfg

	log.Info("RestartNode: bouncing daemon")
	return svc.RestartWithConfig(cfg)
}
