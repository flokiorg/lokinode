package wails

import (
	"context"
	crypto_rand "crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/db"
	lokitray "github.com/flokiorg/lokinode/tray"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gorm.io/gorm"
)

// instanceLockPort is a loopback TCP port held exclusively by the running
// Lokinode instance. If binding fails another instance is already running.
const instanceLockPort = "51016"

// App is the Wails application struct. Keep this thin — business logic lives
// in the daemon package.
type App struct {
	ctx           context.Context
	wailsJSON     string
	version       string
	apiToken      string
	apiServerPort int

	// db is the persistent SQLite database for node and config storage.
	db *gorm.DB

	// flndCfg holds the last successfully validated config (set by VerifyConfig).
	flndCfg *flnd.Config

	// nodeService is the running daemon service (set by RunNode).
	// nodeServiceMu guards all reads and writes of nodeService.
	nodeServiceMu sync.Mutex
	nodeService   *daemon.Service

	// singletonLn is a loopback TCP listener held for the app lifetime.
	// If binding fails at startup, another Lokinode instance is already running.
	singletonLn net.Listener
}

var errNoProfile = errors.New("no node profile configured")

// New creates a new App instance. wailsJSON is the embedded wails.json content
// and version is the embedded VERSION file content, both from the root
// package (go:embed cannot cross directory boundaries).
func New(wailsJSON, version string) *App {
	b := make([]byte, 32)
	if _, err := crypto_rand.Read(b); err != nil {
		// The OS CSPRNG is unavailable - continuing would mean serving the
		// API behind a weak/predictable token, so fail loudly instead.
		panic("failed to generate API token: " + err.Error())
	}
	token := hex.EncodeToString(b)
	return &App{wailsJSON: wailsJSON, version: strings.TrimSpace(version), apiToken: token}
}

// Context returns the application context.
func (a *App) Context() context.Context {
	return a.ctx
}

// GetAPIToken returns the API token generated at startup.
func (a *App) GetAPIToken() string {
	return a.apiToken
}

// SetAPIServerPort stores the loopback port the API HTTP server is bound to.
func (a *App) SetAPIServerPort(port int) { a.apiServerPort = port }

// GetAPIServerPort returns the loopback port the API HTTP server is bound to.
func (a *App) GetAPIServerPort() int { return a.apiServerPort }

// Startup is called by Wails when the application starts.
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	// Try to acquire the singleton lock. On failure another instance is running.
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp4", "127.0.0.1:"+instanceLockPort)
	if err == nil {
		log.Info().Msg("singleton lock acquired")
		a.singletonLn = ln
		// Accept connections as a fallback show-signal: when a second instance
		// connects to the port (via TrySignalRunningInstance) and Wails' own IPC
		// fails, this goroutine brings the window to the front.
		go func() {
			for {
				conn, err := ln.Accept()
				if err != nil {
					return // listener closed on Shutdown
				}
				_ = conn.Close()
				lokitray.ShowInDock()
				runtime.WindowShow(ctx)
			}
		}()
	} else {
		log.Warn().Msg("another instance detected; singleton lock not acquired")
	}

	// Initialize database
	gormDB, err := db.Init()
	if err != nil {
		log.Error().Err(err).Msg("database init failed; node management will be degraded")
	} else {
		log.Info().Msg("database initialized")
		a.db = gormDB
	}
}

// Shutdown is called by Wails when the application is about to quit.
func (a *App) Shutdown(_ context.Context) {
	log.Info().Msg("app shutdown initiated")
	if a.singletonLn != nil {
		_ = a.singletonLn.Close()
	}
	a.nodeServiceMu.Lock()
	svc := a.nodeService
	a.nodeServiceMu.Unlock()
	if svc != nil {
		go svc.Stop() // best-effort: daemon receives graceful shutdown signal before OS exit
	}
	log.Info().Msg("app shutdown complete")
}

// IsAnotherInstanceRunning reports whether a second Lokinode window is open.
func (a *App) IsAnotherInstanceRunning() bool {
	return a.singletonLn == nil
}

// TrySignalRunningInstance connects to the singleton port. If another instance
// is listening it will receive the connection and show its window. Returns true
// when another instance was found, so the caller can exit immediately.
func TrySignalRunningInstance() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp4", "127.0.0.1:"+instanceLockPort)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// GetVersion returns the app's own version identity, e.g. "v0.1.7-rc1".
// Sourced from the embedded VERSION file (the release tag), NOT
// wails.json's productVersion: that field is native OS packaging metadata
// (macOS Info.plist / Windows exe resource) embedded at build time and is
// kept plain-numeric on purpose so an RC's "-rcN" suffix never has to flow
// through native version-string parsing. VERSION is a plain text file with
// no such constraint, so it's the correct source for the identity string
// actually shown to users and compared against GetGithubLatestVersion.
func (a *App) GetVersion() string {
	return a.version
}

// Service returns the running daemon service (nil if node not started yet).
func (a *App) Service() *daemon.Service {
	a.nodeServiceMu.Lock()
	defer a.nodeServiceMu.Unlock()
	return a.nodeService
}

// Config returns the last validated FLND config (nil if VerifyConfig not called yet).
func (a *App) Config() *flnd.Config {
	return a.flndCfg
}

// GetDB returns the persistent GORM database connection.
func (a *App) GetDB() *gorm.DB {
	return a.db
}

// ExplorerHost returns the block explorer base URL.
func (a *App) ExplorerHost() string {
	return "https://lokichain.info"
}

// GetLogDir returns the log directory for the active node.
// Priority: running daemon config → last pubkey → last dir → platform default.
// The path is always derived server-side; no client input is accepted.
func (a *App) GetLogDir() string {
	if a.flndCfg != nil {
		return a.flndCfg.LogDir
	}
	if a.db != nil {
		var appCfg db.AppConfig
		if err := a.db.First(&appCfg, "key = ?", db.ConfigKeyLastNodePubKey).Error; err == nil && appCfg.Value != "" {
			var node db.Node
			if err := a.db.First(&node, "pub_key = ?", appCfg.Value).Error; err == nil && node.Dir != "" {
				return filepath.Join(filepath.Clean(node.Dir), "logs", "flokicoin", "main")
			}
		}
		var dirCfg db.AppConfig
		if err := a.db.First(&dirCfg, "key = ?", db.ConfigKeyLastNodeDir).Error; err == nil && dirCfg.Value != "" {
			return filepath.Join(filepath.Clean(dirCfg.Value), "logs", "flokicoin", "main")
		}
	}
	return filepath.Join(a.GetDefaultNodeDir(), "logs", "flokicoin", "main")
}
