#!/bin/bash
set -e

# Expected environment variables:
# TAG: version tag (e.g., v0.1.0)
# GOARCH: amd64 or arm64 (build runs natively on a matching hosted runner, no cross-compile)
# DEB_SUFFIX, LIBWEBKIT, LIBWEBKIT_RPM: set by the workflow matrix for the legacy/modern split

if [ -z "$TAG" ]; then
    if [ -f "VERSION" ]; then
        TAG=$(cat VERSION)
    else
        echo "TAG environment variable is required."
        exit 1
    fi
fi

GOOS="linux"

export GOFLAGS="-buildvcs=false"

echo "Linux Build Script Started. TAG=$TAG GOARCH=$GOARCH"

mkdir -p ops/bin

# -----------------------------------------------------------------------------
# 1. Frontend Build
# -----------------------------------------------------------------------------
echo "--- Building Frontend ---"
cd frontend
pnpm install --frozen-lockfile
pnpm run build
cd ..

# -----------------------------------------------------------------------------
# 2. Desktop Binary + AppDir Staging
# -----------------------------------------------------------------------------
echo "--- Building Desktop Binary ---"

rm -rf build/bin AppDir
mkdir -p build/bin

BASENAME="lokinode-${GOOS}-${GOARCH}"

go build -trimpath -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc -ldflags "-s -w" \
    -o "build/bin/${BASENAME}" .

echo "--- Staging AppDir ---"
mkdir -p AppDir/usr/bin
mkdir -p AppDir/usr/share/applications
mkdir -p AppDir/usr/share/icons/hicolor/256x256/apps

cp "build/bin/${BASENAME}" "AppDir/usr/bin/lokinode"
cp "build/AppIcon.png" "AppDir/usr/share/icons/hicolor/256x256/apps/lokinode.png"
cp "ops/packaging/lokinode.desktop" "AppDir/usr/share/applications/lokinode.desktop"

# AppImage assembly itself happens in the workflow via appimage-builder,
# reading the AppDir staged above.

# -----------------------------------------------------------------------------
# 3. Native Packaging (DEB/RPM) via nfpm
# -----------------------------------------------------------------------------
echo "--- Native Packaging (DEB/RPM) ---"

TARGET_BINARY="lokinode-linux-${GOARCH}${DEB_SUFFIX}"
cp "build/bin/${BASENAME}" "ops/bin/${TARGET_BINARY}"

# nfpm.yaml uses nfpm's native ${VAR} env-var expansion directly - no
# preprocessing needed, just export the values it references.
export GOARCH TAG
export BINARY_NAME="$TARGET_BINARY"
export LIBWEBKIT LIBWEBKIT_RPM

DEB_NAME="lokinode-linux${DEB_SUFFIX}-${GOARCH}-${TAG}.deb"
nfpm package --config ops/packaging/nfpm.yaml --packager deb --target "ops/bin/${DEB_NAME}"

RPM_ARCH="x86_64"
if [ "$GOARCH" == "arm64" ]; then
    RPM_ARCH="aarch64"
fi
RPM_NAME="lokinode-linux${DEB_SUFFIX}-${RPM_ARCH}-${TAG}.rpm"
nfpm package --config ops/packaging/nfpm.yaml --packager rpm --target "ops/bin/${RPM_NAME}"

rm "ops/bin/${TARGET_BINARY}"

echo "Build Complete. Artifacts in ops/bin:"
ls -lh ops/bin
