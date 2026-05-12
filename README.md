# Lokinode

Lokinode is a cross-platform desktop app for running and managing a Flokicoin full node (FLND), built with the Wails framework in Go.

📖 https://docs.flokicoin.org/wallets/lokinode/

## Features

- Initialize, unlock, and manage your Flokicoin wallet
- Send and receive FLC with fee estimation
- Transaction history
- Real-time node info: sync status, block height, mempool tip
- Settings: change password, network info, log viewer
- Runs on Linux, macOS, and Windows

## Development

**Prerequisites:** Go 1.26+, Node.js 20+, pnpm, Wails v2

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.9.3
```

```bash
git clone https://github.com/flokiorg/lokinode.git
cd lokinode
just dev
```

## Build

Builds are handled via Docker-based scripts in [`ops/`](ops/) — see [`.github/workflows/`](.github/workflows/).

## License

MIT
