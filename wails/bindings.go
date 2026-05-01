package wails

import (
	"errors"
	"os"

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
