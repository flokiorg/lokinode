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
    local BASENAME="lokinode-macos"
    local ARCHIVE_NAME="lokinode-macos-${TAG}"

    echo "Building macOS Desktop (Universal)..."

    rm -rf build/bin

    # The embedded flnd only compiles an RPC subserver when its build tag is
    # set, so this list — not flnd — decides what the shipped node serves.
    # signrpc is load-bearing: without it flnd serves a no-op signrpc.Signer
    # and lokihub cannot sign its transport announcement. Keep both slices
    # below in step with the dev set in the justfile; buildtags_test.go
    # enforces the required tags are present here.
    echo "Building Desktop AMD64 slice..."
    CGO_ENABLED=1 GOOS=darwin GOARCH=amd64 CC="clang -arch x86_64" \
    wails build -platform "darwin/amd64" -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc,signrpc -trimpath \
            -ldflags "-s -w" \
            -o "${BASENAME}-amd64" -clean

    if [ -d "build/bin/Lokinode.app" ]; then
        mv "build/bin/Lokinode.app" "build/bin/${BASENAME}-amd64.app"
    fi

    echo "Building Desktop ARM64 slice..."
    CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 CC="clang -arch arm64" \
    wails build -platform "darwin/arm64" -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc,signrpc -trimpath \
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

    # Wails ad-hoc signs each per-arch .app during `wails build`, but the lipo
    # merge above and the icon copy just above both modify the bundle after
    # that, invalidating the signature (mismatched checksum -> Gatekeeper
    # shows "app is damaged", not the normal bypassable "unidentified
    # developer" prompt). Strip quarantine xattrs and re-sign ad-hoc now that
    # the bundle is final, no earlier and no later.
    echo "Ad-hoc signing the universal app bundle..."
    xattr -cr "$APP_DEST" 2>/dev/null || true
    codesign --remove-signature "$APP_DEST" 2>/dev/null || true
    codesign --force --deep --sign - "$APP_DEST"
    codesign --verify --deep --strict "$APP_DEST" && echo "codesign: ad-hoc signature valid" || echo "Warning: codesign --verify failed"

    if [ -d "$APP_DEST" ]; then
        # Build the styled drag-to-Applications dmg with appdmg, which writes the
        # window layout directly (no Finder), so it works on the headless
        # Codemagic builder too -- create-dmg's Finder AppleScript times out there
        # (-1712), which left the Codemagic-built dmg unstyled. Fall back to a
        # plain hdiutil dmg only if appdmg is unavailable.
        command -v gm >/dev/null 2>&1 || brew install graphicsmagick >/dev/null 2>&1 || true
        command -v appdmg >/dev/null 2>&1 || npm install -g appdmg >/dev/null 2>&1 || true
        cat > /tmp/appdmg.json <<JSONEOF
{
  "title": "Lokinode",
  "icon": "$PWD/build/darwin/AppIcon.icns",
  "background": "$PWD/build/darwin/dmg-background.png",
  "icon-size": 100,
  "window": { "position": { "x": 200, "y": 120 }, "size": { "width": 800, "height": 400 } },
  "contents": [
    { "x": 200, "y": 190, "type": "file", "path": "$PWD/$APP_DEST" },
    { "x": 600, "y": 185, "type": "link", "path": "/Applications" }
  ]
}
JSONEOF
        rm -f "$DMG_PATH" ops/bin/rw.*.dmg
        if command -v appdmg >/dev/null 2>&1 && appdmg /tmp/appdmg.json "$DMG_PATH"; then
            echo "appdmg: styled dmg created"
        else
            echo "Warning: appdmg unavailable/failed; building a plain hdiutil dmg"
            rm -f "$DMG_PATH" ops/bin/rw.*.dmg
            hdiutil create -volname "Lokinode" -srcfolder "$APP_DEST" -ov -format UDZO "$DMG_PATH"
        fi
        rm -f ops/bin/rw.*.dmg
    fi

    rm -rf "$APP_DEST"
}

echo "--- Building Darwin Desktop ---"
build_macos_desktop

echo "macOS Build Script Complete."
ls -lh ops/bin
