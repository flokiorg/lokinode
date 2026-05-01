package main

import (
	"context"
	"embed"
	_ "embed"
	"sync/atomic"

	lokiapi "github.com/flokiorg/lokinode/api"
	lokidev "github.com/flokiorg/lokinode/dev"
	"github.com/flokiorg/lokinode/lokilog"
	lokitray "github.com/flokiorg/lokinode/tray"
	lokiapp "github.com/flokiorg/lokinode/wails"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed wails.json
var wailsJSON string

//go:embed build/TrayIcon.svg
var trayIconSVG []byte

//go:embed build/TrayIcon.png
var trayIconPNG []byte // fallback if SVG rendering fails

// resolveTrayIcon renders the SVG to the correct platform format.
// Falls back to scaling the static PNG through the same platform path if SVG rendering fails.
func resolveTrayIcon() []byte {
	icon, err := lokitray.RenderIcon(trayIconSVG)
	if err == nil && len(icon) > 0 {
		return icon
	}
	icon, err = lokitray.RenderIconFromPNG(trayIconPNG)
	if err == nil && len(icon) > 0 {
		return icon
	}
	return nil
}

func main() {
	lokilog.Init()
	app := lokiapp.New(wailsJSON)
	// bindings is the narrow Wails JS bridge — only OS-level dialog operations.
	// Sensitive data methods (GenSeed, Unlock, macaroon paths, etc.) are NOT
	// exposed here; they go through the Echo HTTP handler instead.
	bindings := lokiapp.NewBindings(app)

	// In dev mode this starts a plain HTTP server on :9191 so Vite can proxy
	// /api/* to it.  In production builds this is a no-op — the AssetServer
	// Handler handles everything.
	lokidev.StartServer(app)

	// quitting is set before runtime.Quit so OnBeforeClose can tell the
	// difference between the user clicking X (hide to tray) and the tray
	// "Quit" item requesting a real shutdown.
	var quitting atomic.Bool

	err := wails.Run(&options.App{
		Title:  "Lokinode",
		Width:  390,
		Height: 720,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "lokinode-singleton-lock",
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				runtime.WindowShow(app.Context())
			},
		},
		MinWidth:         390,
		MinHeight:        720,
		MaxWidth:         390,
		MaxHeight:        720,
		AssetServer:      &assetserver.Options{Assets: assets, Handler: lokiapi.NewHandler(app)},
		BackgroundColour: &options.RGBA{R: 18, G: 18, B: 18, A: 1},
		OnStartup: func(ctx context.Context) {
			lokitray.Setup("Lokinode", resolveTrayIcon(), func() {
				lokitray.ShowInDock()
				runtime.WindowShow(ctx)
			}, func() {
				quitting.Store(true)
				runtime.Quit(ctx)
			})
			app.Startup(ctx)
		},
		OnBeforeClose: func(ctx context.Context) bool {
			if quitting.Load() {
				return false // let the real quit through
			}
			runtime.WindowHide(ctx)
			lokitray.HideFromDock()
			return true
		},
		OnShutdown:    app.Shutdown,
		Bind:          []interface{}{bindings},
		DisableResize: true,
		Frameless:     false,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
