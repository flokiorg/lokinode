set dotenv-load := true

default:
    @just --list

# Install all dev requirements (run once before first `just dev`)
setup:
    brew install pnpm
    go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
    @just install

# Install project dependencies
install:
    cd frontend && pnpm install
    go mod download

dev:
    wails dev -tags "autopilotrpc signrpc walletrpc chainrpc invoicesrpc watchtowerrpc neutrinorpc routerrpc monitoring peersrpc kvdb_sqlite"

# Kill all flokicoin-related processes so `just dev` can bind its ports cleanly.
stop:
    # 1. Graceful first: SIGINT/SIGTERM so the app closes its own RPC (10005) and
    #    P2P (5521) listeners. A hard SIGKILL here leaves those sockets to be
    #    inherited and held open by a parent process (notably VS Code's JS
    #    auto-attach debugger), which then blocks the next `just dev` for the
    #    lifetime of that editor session.
    -pkill -INT  -f "wails dev" 2>/dev/null || true
    -pkill -TERM -f "lokinode"  2>/dev/null || true
    sleep 2
    # 2. Force-kill whatever ignored the signal.
    -pkill -9 -f "wails dev" 2>/dev/null || true
    -pkill -9 -f "lokinode"  2>/dev/null || true
    -pkill -9 -f "frontend/node_modules/.bin/vite" 2>/dev/null || true
    -pkill -9 -f "pnpm run dev" 2>/dev/null || true
    # 3. Last-resort net: anything still holding the flnd RPC or P2P ports
    #    (e.g. a leaked fd in an unrelated parent). Prints the culprit first.
    -lsof -nP -iTCP:10005 -sTCP:LISTEN 2>/dev/null || true
    -lsof -ti tcp:10005 | xargs kill -9 2>/dev/null || true
    -lsof -ti tcp:5521  | xargs kill -9 2>/dev/null || true
