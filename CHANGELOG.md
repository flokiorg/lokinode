# Changelog

## [v0.1.7-rc4]

⚠️ **Release candidate — for testing only, not the recommended build.** If you're not
specifically testing these fixes, stay on the latest stable release.

Replaces `v0.1.7-rc3`.

### Bug Fixes

- Fixed the Settings gear icon staying hidden while the node was starting up or syncing.
  It now shows as soon as the node service is running, instead of waiting for a full sync.
- Fixed the Settings gear sometimes not responding to clicks, occluded by an overlapping
  header element.
- The Macaroon/TLS-certificate hex value in Settings → Network now shows "Available once
  unlocked" while the wallet is locked or starting, instead of a bare "—" that looked like
  a genuinely empty field.

### Please test

- Launch the app and confirm the Settings gear is visible and clickable in the header
  while the node is still starting/syncing, not only once it reaches "ready".
- Open Settings → Network while the wallet is locked/starting and confirm the Macaroon/TLS
  hex fields show "Available once unlocked", then confirm they populate normally once
  unlocked.

Report back on the PR or issue tracker.

## [v0.1.7-rc3]

⚠️ **Release candidate — for testing only, not the recommended build.** If you're not
specifically testing something below, stay on the latest stable release.

Replaces `v0.1.7-rc2`. Contains an **unverified visual/interaction change** — please read
"Please test" below before reporting other issues.

### Changes

- Version number removed from the home page / top bar. It's still shown under
  Settings → About.
- **macOS**: the title bar is now hidden and content fills the whole window, matching
  modern desktop apps — the native close/minimize/zoom buttons stay in the top-left corner.
- **Windows**: native window chrome is replaced with a custom minimize/close button pair
  in the top-right corner, same idea. (Linux is unchanged.)

### Please test — this build was not verified on real hardware

The window-chrome change above was built and compiled in an environment with no macOS or
Windows machine available, so it has **not** been visually confirmed. On macOS or Windows,
please check:
- The window can still be moved by clicking and dragging empty space near the top.
- **macOS**: the traffic-light buttons are visible, positioned normally, and close hides
  the app to the tray (not quits it) unless you use the tray menu's Quit.
- **Windows**: the minimize/close buttons in the top-right work, and there's no leftover/
  double window chrome.

Report anything that looks or behaves wrong on the PR or issue tracker.

## [v0.1.7-rc2]

⚠️ **Release candidate — for testing only, not the recommended build.** If you're not
specifically testing this fix, stay on the latest stable release.

Replaces `v0.1.7-rc1`, which shipped with two display bugs (see Bug Fixes below) — if you
installed rc1, please switch to this build.

### Bug Fixes

- Fixed the node silently relocking the wallet, or getting stuck on "Connecting to chain…"
  indefinitely with no way back except a manual stop + unlock, after the host machine's
  internet connection dropped and came back.
- Fixed the in-app version showing "v0.1.7" instead of the full "v0.1.7-rc2".
- Fixed a false "new version available" prompt pointing at an older stable release while
  already running this RC.

### Please test

Unplug/reconnect (or toggle Wi-Fi/networking off and on) while the node is syncing or
active, and confirm it recovers on its own. Report back on the PR or issue tracker.

## [v0.1.7-rc1]

⚠️ **Release candidate — for testing only, not the recommended build.** If you're not
specifically testing this fix, stay on the latest stable release.

### Bug Fixes

- Fixed the node silently relocking the wallet, or getting stuck on "Connecting to chain…"
  indefinitely with no way back except a manual stop + unlock, after the host machine's
  internet connection dropped and came back.

### Please test

Unplug/reconnect (or toggle Wi-Fi/networking off and on) while the node is syncing or
active, and confirm it recovers on its own. Report back on the PR or issue tracker.

## [v0.1.6]

### Improvements

- **Logs while starting** — A "View logs" link on the syncing and error screens opens a full-screen live log panel. Previously the log viewer was only reachable from Settings, which is hidden until the node is fully running.
- **Escape hatches on the sync screen** — The "Connecting to chain…" screen now offers "Stop node" / "Power off" actions, and surfaces a "taking longer than expected" hint after 45s with no progress, instead of being a dead end.
- **Open data folder** — A folder action on the home screen, the node overview, and each row of the existing-nodes list opens the node's data directory in the OS file manager.

### Bug Fixes

- Fixed the app getting permanently stuck on "Connecting to chain… 0.0%" when the daemon failed to start — it now shows the actual error with a working Retry.
- Fixed Retry / power-on after a crash silently doing nothing: a leaked process-wide signal interceptor made the restart hang without ever starting a new daemon.
- Fixed a brief "Node Error" flash when powering the node back on after a deliberate Power off (stale event from the previous daemon).

### Infrastructure

- Aligned the Wails CLI (`v2.12.0`) with the library version across CI, the `justfile`, and the README.
- `just stop` now shuts the node down gracefully before force-killing, so its RPC/P2P ports are released cleanly and can't be held open by a parent process.
- Removed stray `npm` / `i` frontend dependencies; pending major upgrades tracked in `docs/DEPENDENCIES.md`.

## [v0.1.5]

### Improvements

- **Neutrino Recovery** — The app now detects a corrupted neutrino header cache (e.g. after an unclean shutdown) and can automatically recover by purging the regenerable cache files and restarting. The UI shows a distinct "tap to recover" prompt and a "Recovering…" spinner during this process, instead of the generic restart flow.
- **Sync Stall Detection** — The daemon now tracks sync progress and automatically restarts if it detects the sync has stalled.
- **Chain Tip Accuracy** — The best header timestamp is now cached and pushed on every block event, so the chain-tip age shown in the UI stays accurate without extra polling.

### Bug Fixes

- Fixed the tray icon not restoring the window when clicked while the app was running in the background.
- App shutdown now runs node service teardown in the background so quitting the app is more reliable and no longer risks hanging.

### Infrastructure

- Migrated CI/CD from self-hosted runners to GitHub-hosted runners (including free arm64 Linux builds) across all four platform workflows.
- Added a PR-gate CI workflow (build/vet/test, golangci-lint, security baseline) and cleared the full golangci-lint backlog.
- Added a single `build-all.yaml` workflow to build Linux, macOS, and Windows together.

## [v0.1.4]

### Improvements

- **Sync Reliability** — Added a gRPC staleness watchdog that re-polls sync status if no blocks are received for 5 minutes. This ensures the UI accurately reflects chain state even if peers are lost.
- **Connection Stability** — Implemented gRPC keepalives to better detect and recover from broken network connections between the app and the flnd daemon.
- **Chain Health Visibility** — The overview tab now displays the time since the last block was received, highlighting it in amber if the chain appears stale (>15 mins).

### Bug Fixes

- Fixed an issue where the node could appear "Synced" while actually being stuck due to peer loss.

## [v0.1.3]

### Improvements

- **Update indicator** — The `?` icon turns amber with a dot badge when a newer version is available. Tooltip shows the available version; clicking opens the download page.
- **Download link** — Update button and header icon now point to `docs.flokicoin.org/wallets/lokinode/`.
- **Semver comparison** — Version check uses proper major/minor/patch comparison instead of string equality.

### Bug Fixes

- **GitHub API URL** — Version fetch was querying `ohstr/lokinode`; corrected to `flokiorg/lokinode`.

## [v0.1.2]

### New Features

- **SegWit / Taproot address type selector** — The Receive screen now shows a SegWit / Taproot toggle. The selection is persisted per node via a new `GET /api/wallet/address/preference` and `PATCH /api/wallet/address/preference` API, so the preferred type survives restarts. Address retrieval uses FLND's `UNUSED_*` address types, meaning the app always displays the last unused address for the selected type without advancing the derivation index on every view.

- **Japanese and Korean UI translations** — Lokinode now ships with full Japanese (日本語) and Korean (한국어) translations, bringing the supported language count to six.

### Improvements

- **Send form fully internationalized** — The "Calculating…" spinner label and inline validation messages ("Amount exceeds your balance", "Amount too high — leave room for the fee") are now translated through the i18n system instead of being hardcoded English strings.

### Bug Fixes

- **Request body limit raised to 4 MB** — The API request-body cap was raised from 64 KB to 4 MB. PSBTs grow by roughly 800 bytes per input when hex-encoded, so wallets with many small UTXOs could silently fail the `/send/finalize-psbt` call under the old limit.

- **Transaction list layout on narrow screens** — Added `min-w-0`, `shrink-0`, and `whitespace-nowrap` guards to the transaction row so the hash, date, and amount columns no longer overflow or collapse on narrower windows. The copy-to-clipboard button now starts fully transparent (`opacity-0`) and fades in on row hover, matching the external-link icon behaviour.

## [v0.1.1]

### Bug Fixes

- **Sync progress updates in real-time** — The progress bar, block count, and last-block timestamp now refresh live during blockchain and wallet sync without requiring the window to lose and regain focus. SSE events now carry `mempoolHeight` and `bestHeaderTimestamp` alongside the existing `blockHeight`, so the UI stays current on every daemon tick (~5 s polling + per-block updates) with no extra REST calls.

- **Stop node shows full stopping animation** — Confirming "Stop Node" now immediately displays the full-screen stopping overlay (spinner + "Stopping…" label) instead of a brief label flicker. The overlay persists through the navigation back to the home screen and dismisses automatically once the daemon has fully exited, with a 10-second safety fallback.

- **Windows tray menu now appears reliably** — Right-clicking the system tray icon on Windows intermittently showed nothing. The root cause was Go's async goroutine preemption migrating the tray's Windows message pump to a different OS thread, breaking Win32's thread-affinity requirement for `GetMessage` and `TrackPopupMenu`. The tray goroutine is now pinned to a single OS thread for its entire lifetime.

## [v0.1.0]

Initial release of Lokinode.

### Features

- **Node Management**: Start, stop, and monitor your Lokinode daemon.
- **Wallet Support**: Basic wallet operations including balance checks and transaction history.
- **Wails-based UI**: A modern desktop interface built with React and Tailwind CSS.
- **Cross-Platform**: Support for Linux, macOS, and Windows.
