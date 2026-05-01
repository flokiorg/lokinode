set dotenv-load := true

default:
    @just --list

# Install all dev requirements (run once before first `just dev`)
setup:
    brew install pnpm
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    @just install

# Install project dependencies
install:
    cd frontend && pnpm install
    go mod download

dev:
    wails dev -tags "autopilotrpc signrpc walletrpc chainrpc invoicesrpc watchtowerrpc neutrinorpc routerrpc monitoring peersrpc kvdb_sqlite"

# Kill all flokicoin-related processes so `just dev` can bind its ports cleanly.
stop:
    # 1. Kill wails dev orchestrator first so it won't restart the app on SIGKILL.
    -pkill -9 -f "wails dev" 2>/dev/null || true
    # 2. Kill the lokinode app binary (flnd runs inside it — no separate flnd process).
    -pkill -9 -f "lokinode" 2>/dev/null || true
    # 3. Safety net: kill anything still holding the flnd RPC or P2P ports.
    -lsof -ti tcp:10005 | xargs kill -9 2>/dev/null || true
    -lsof -ti tcp:5521  | xargs kill -9 2>/dev/null || true
    # 6. Kill the vite dev server spawned by wails via frontend:dev:watcher.
    -pkill -9 -f "frontend/node_modules/.bin/vite" 2>/dev/null || true
    -pkill -9 -f "pnpm run dev" 2>/dev/null || true
