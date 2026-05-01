//go:build windows
package tray

import "github.com/getlantern/systray"

func HideFromDock() {}
func ShowInDock()   {}

func Setup(title string, icon []byte, onShow func(), onQuit func()) {
	go systray.Run(func() {
		if len(icon) > 0 {
			systray.SetIcon(icon)
		}
		systray.SetTitle(title)
		systray.SetTooltip(title)

		mShow := systray.AddMenuItem("Show Lokinode", "Show the Lokinode window")
		systray.AddSeparator()
		mQuit := systray.AddMenuItem("Quit", "Quit Lokinode")

		go func() {
			for {
				select {
				case <-mShow.ClickedCh:
					onShow()
				case <-mQuit.ClickedCh:
					systray.Quit()
					onQuit()
				}
			}
		}()
	}, func() {})
}
