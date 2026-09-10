package wails

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/flokiorg/lokinode/db"
	"github.com/pkg/browser"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Bindings is the only struct exposed to the Wails JS bridge (window['go']).
// It is intentionally narrow — only native OS dialog operations that have no
// HTTP equivalent are exposed here.
//
// Security: binding *App directly would expose GetAdminMacaroonPath,
// VerifyConfig, RunNode, StopNode, and other sensitive methods to anyone
// with access to the WebView DevTools console.  All data operations go
// through the Echo HTTP handler (/api/*) which is only reachable from the
// embedded WebView, not from external processes.
type Bindings struct {
	app *App
}

// NewBindings returns a Bindings that wraps app for OS-level dialog access.
func NewBindings(app *App) *Bindings {
	return &Bindings{app: app}
}

// GetDefaultNodeDir returns the platform-default FLND data directory.
func (b *Bindings) GetDefaultNodeDir() string {
	return b.app.GetDefaultNodeDir()
}

// GetAPIToken returns the token that the frontend must send in the X-API-Token header.
func (b *Bindings) GetAPIToken() string {
	return b.app.GetAPIToken()
}

// GetAPIServerPort returns the loopback port of the real HTTP server.
// The frontend uses this to connect directly (bypassing the Wails scheme handler)
// for SSE endpoints that require streaming.
func (b *Bindings) GetAPIServerPort() int {
	return b.app.GetAPIServerPort()
}

// OpenDirectorySelector opens a native OS directory-picker dialog and returns
// the chosen path.  Returns an error if the user cancels.
func (b *Bindings) OpenDirectorySelector(opts runtime.OpenDialogOptions) (string, error) {
	if _, err := os.Stat(opts.DefaultDirectory); err != nil {
		opts.DefaultDirectory = ""
	}
	dir, err := runtime.OpenDirectoryDialog(b.app.ctx, opts)
	if err != nil {
		return "", err
	}
	if dir == "" {
		return "", errors.New("user canceled")
	}
	return dir, nil
}

// RevealNodeFolder opens dir in the OS file manager (Finder / Explorer / the
// desktop's xdg handler). This is a native shell operation with no HTTP
// equivalent, so — like the dialog helpers above — it lives on the bridge
// rather than the Echo API.
//
// Security: dir is never trusted. It must resolve to either the currently
// running node's directory or a directory tracked in the Lokinode DB;
// anything else is rejected so the WebView console cannot use this to open
// arbitrary filesystem locations.
func (b *Bindings) RevealNodeFolder(dir string) error {
	if dir == "" {
		return errors.New("no directory")
	}
	clean := filepath.Clean(dir)

	if !b.isKnownNodeDir(clean) {
		return errors.New("directory is not a known node")
	}

	info, err := os.Stat(clean)
	if err != nil {
		return fmt.Errorf("directory not found: %w", err)
	}
	if !info.IsDir() {
		return errors.New("path is not a directory")
	}

	// file:// URL is handled cross-platform by pkg/browser (open / xdg-open /
	// explorer) and opens the file manager at that location.
	return browser.OpenURL("file://" + filepath.ToSlash(clean))
}

// isKnownNodeDir reports whether clean matches the running node's directory or
// any directory recorded in the Lokinode DB.
func (b *Bindings) isKnownNodeDir(clean string) bool {
	if cfg := b.app.Config(); cfg != nil && filepath.Clean(cfg.LndDir) == clean {
		return true
	}
	gormDB := b.app.GetDB()
	if gormDB == nil {
		return false
	}
	var nodes []db.Node
	if err := gormDB.Find(&nodes).Error; err != nil {
		return false
	}
	for _, n := range nodes {
		if filepath.Clean(n.Dir) == clean {
			return true
		}
	}
	return false
}

// OpenFileSelector opens a native OS file-picker dialog and returns the
// chosen path.  Returns an error if the user cancels.
func (b *Bindings) OpenFileSelector(opts runtime.OpenDialogOptions) (string, error) {
	if _, err := os.Stat(opts.DefaultDirectory); err != nil {
		opts.DefaultDirectory = ""
	}
	path, err := runtime.OpenFileDialog(b.app.ctx, opts)
	if err != nil {
		return "", err
	}
	if path == "" {
		return "", errors.New("user canceled")
	}
	return path, nil
}
