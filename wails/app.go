package wails

import (
	"bytes"
	"context"
	crypto_rand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/flokiorg/flnd"
	"github.com/flokiorg/lokinode/daemon"
	"github.com/flokiorg/lokinode/db"
	"github.com/tidwall/gjson"
	"gorm.io/gorm"
)

// instanceLockPort is a loopback TCP port held exclusively by the running
// Lokinode instance. If binding fails another instance is already running.
const instanceLockPort = "59489"

// App is the Wails application struct. Keep this thin — business logic lives
// in the daemon package.
type App struct {
	ctx           context.Context
	wailsJSON     string
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
// from the root package (go:embed cannot cross directory boundaries).
func New(wailsJSON string) *App {
	b := make([]byte, 32)
	crypto_rand.Read(b) // use crypto/rand here
	token := hex.EncodeToString(b)
	return &App{wailsJSON: wailsJSON, apiToken: token}
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
	ln, err := net.Listen("tcp4", "127.0.0.1:"+instanceLockPort)
	if err == nil {
		a.singletonLn = ln
	}

	// Initialize database
	gormDB, err := db.Init()
	if err != nil {
		// Log error and proceed if possible, though node management will be degraded
		fmt.Printf("failed to initialize database: %v\n", err)
	} else {
		a.db = gormDB
	}
}

// Shutdown is called by Wails when the application is about to quit.
func (a *App) Shutdown(_ context.Context) {
	if a.singletonLn != nil {
		a.singletonLn.Close()
	}
	a.nodeServiceMu.Lock()
	svc := a.nodeService
	a.nodeServiceMu.Unlock()
	if svc != nil {
		svc.Stop()
	}
}

// IsAnotherInstanceRunning reports whether a second Lokinode window is open.
func (a *App) IsAnotherInstanceRunning() bool {
	return a.singletonLn == nil
}

// GetVersion returns the current app version from wails.json.
func (a *App) GetVersion() string {
	version := gjson.Get(a.wailsJSON, "info.productVersion")
	return "v" + version.String()
}

// VersionCtrl holds version comparison data for update checks.
type VersionCtrl struct {
	CurrentVersion string
	LatestVersion  string
	NeedUpdate     bool
}

// FetchVersionInfo fetches the latest GitHub release and compares with current.
func (a *App) FetchVersionInfo() (versionCtrl VersionCtrl, err error) {
	versionCtrl.CurrentVersion = a.GetVersion()
	versionCtrl.LatestVersion, err = GetGithubLatestVersion()
	if err != nil {
		return
	}
	latestNum, err := strconv.ParseInt(strings.ReplaceAll(strings.TrimPrefix(versionCtrl.LatestVersion, "v"), ".", ""), 10, 64)
	if err != nil {
		return versionCtrl, fmt.Errorf("latest version[%s] is illegal", versionCtrl.LatestVersion)
	}
	currentNum, err := strconv.ParseInt(strings.ReplaceAll(strings.TrimPrefix(versionCtrl.CurrentVersion, "v"), ".", ""), 10, 64)
	if err != nil {
		return versionCtrl, fmt.Errorf("current version[%s] is illegal", versionCtrl.CurrentVersion)
	}
	if latestNum > currentNum {
		versionCtrl.NeedUpdate = true
	}
	return
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

// stringReader wraps a string as an io.Reader for config parsing.
func stringReader(s string) *bytes.Reader {
	return bytes.NewReader([]byte(s))
}
