#!/bin/bash
set -e

# Expected environment variables:
# TAG: version tag
# Assumes Go, Node, pnpm, Wails are installed on the macOS runner.

if [ -z "$TAG" ]; then
    if [ -f "VERSION" ]; then
        TAG=$(cat VERSION)
    else
        echo "TAG environment variable is required."
        exit 1
    fi
fi

echo "macOS Build Script Started. TAG=$TAG"
mkdir -p ops/bin

# -----------------------------------------------------------------------------
# 1. Setup
# -----------------------------------------------------------------------------
if ! command -v create-dmg &> /dev/null; then
    echo "create-dmg could not be found, installing..."
    brew install create-dmg
fi

rm -rf build/bin
mkdir -p build

# -----------------------------------------------------------------------------
# 2. Frontend Build
# -----------------------------------------------------------------------------
echo "--- Building Frontend ---"
cd frontend
pnpm install
pnpm run build
cd ..

# -----------------------------------------------------------------------------
# 3. Build Desktop (Universal)
# -----------------------------------------------------------------------------
build_macos_desktop() {
    local BASENAME="lokinode-desktop-macos"
    local ARCHIVE_NAME="lokinode-desktop-macos-${TAG}"

    echo "Building macOS Desktop (Universal)..."

    rm -rf build/bin

    echo "Building Desktop AMD64 slice..."
    CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 CC="clang -arch x86_64" \
    wails build -platform "darwin/amd64" -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc -trimpath \
            -ldflags "-s -w" \
            -o "${BASENAME}-amd64" -clean

    if [ -d "build/bin/Lokinode.app" ]; then
        mv "build/bin/Lokinode.app" "build/bin/${BASENAME}-amd64.app"
    fi

    echo "Building Desktop ARM64 slice..."
    CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 CC="clang -arch arm64" \
    wails build -platform "darwin/arm64" -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc -trimpath \
            -ldflags "-s -w" \
            -o "${BASENAME}-arm64"

    if [ -d "build/bin/Lokinode.app" ]; then
        mv "build/bin/Lokinode.app" "build/bin/${BASENAME}-arm64.app"
    fi

    echo "Contents of build/bin:"
    ls -R build/bin

    local APP_AMD64="build/bin/${BASENAME}-amd64.app"
    local APP_ARM64="build/bin/${BASENAME}-arm64.app"
    local FINAL_APP="build/bin/${BASENAME}.app"

    echo "Creating Universal App Bundle..."
    cp -r "$APP_ARM64" "$FINAL_APP"

    local BIN_AMD64=$(find "$APP_AMD64/Contents/MacOS" -type f -perm +111 | head -n 1)
    local BIN_ARM64=$(find "$APP_ARM64/Contents/MacOS" -type f -perm +111 | head -n 1)
    local BIN_DEST="$FINAL_APP/Contents/MacOS/$(basename "$BIN_ARM64")"

    if [[ -z "$BIN_AMD64" || -z "$BIN_ARM64" ]]; then
        echo "Error: Could not find binaries to lipo."
        exit 1
    fi

    lipo -create -output "$BIN_DEST" "$BIN_AMD64" "$BIN_ARM64"

    echo "Verifying Universal Binary:"
    file "$BIN_DEST"

    rm -rf "$APP_AMD64" "$APP_ARM64"

    local APP_DEST="ops/bin/lokinode.app"
    local DMG_PATH="ops/bin/${ARCHIVE_NAME}.dmg"

    rm -rf "$APP_DEST"
    mv "$FINAL_APP" "$APP_DEST"

    cp "build/darwin/AppIcon.icns" "$APP_DEST/Contents/Resources/AppIcon.icns" || echo "Warning: Could not copy icon"
    touch "$APP_DEST"

    if [ -d "$APP_DEST" ]; then
        create-dmg \
            --volname "Lokinode" \
            --volicon "build/darwin/AppIcon.icns" \
            --background "build/darwin/dmg-background.png" \
            --window-pos 200 120 \
            --window-size 800 400 \
            --icon-size 100 \
            --icon "lokinode.app" 200 190 \
            --hide-extension "lokinode.app" \
            --app-drop-link 600 185 \
            "$DMG_PATH" \
            "$APP_DEST"
    fi

    rm -rf "$APP_DEST"
}

echo "--- Building Darwin Desktop ---"
build_macos_desktop

echo "macOS Build Script Complete."
ls -lh ops/bin
