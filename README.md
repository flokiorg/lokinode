> [!IMPORTANT]
> **This repository has moved to Flokicoin's own git server.**
> Development of `lokinode` now happens at
> `nostr://npub1lfwkfe3kt60wa3nqeysmwz3t7h7n3p0zpruqd7yzlqf500rnp68qxzkjuj/grasp.flokicoin.org/lokinode`,
> with its full history. This GitHub copy stays readable, but new changes, issues and pull requests go to the new home.
> To clone it: install [ngit](https://ngit.dev) and run `git clone nostr://npub1lfwkfe3kt60wa3nqeysmwz3t7h7n3p0zpruqd7yzlqf500rnp68qxzkjuj/grasp.flokicoin.org/lokinode`.

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
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
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
