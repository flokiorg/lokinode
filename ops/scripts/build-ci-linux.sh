#!/bin/bash
set -e

# Expected environment variables:
# TAG: version tag (e.g., v0.1.0)
# GOOS, GOARCH, CC: Set by Docker environment
# LINUXDEPLOY_BIN: Path to linuxdeploy AppImage

if [ -z "$TAG" ]; then
    if [ -f "VERSION" ]; then
        TAG=$(cat VERSION)
    else
        echo "TAG environment variable is required."
        exit 1
    fi
fi

# Disable VCS stamping
export GOFLAGS="-buildvcs=false"

# Apply Cross-Compilation Flags if present
if [ -n "$CROSS_CGO_CFLAGS" ]; then
    echo "Applying Cross-Compilation Flags..."
    export CGO_CFLAGS="$CROSS_CGO_CFLAGS"
    export CGO_LDFLAGS="$CROSS_CGO_LDFLAGS"
    export PKG_CONFIG_DIR="$CROSS_PKG_CONFIG_DIR"
    export PKG_CONFIG_LIBDIR="$CROSS_PKG_CONFIG_LIBDIR"
    export PKG_CONFIG_SYSROOT_DIR="$CROSS_PKG_CONFIG_SYSROOT_DIR"
fi

echo "Build Script Started. TAG=$TAG"
echo "Target: $GOOS/$GOARCH using CC=$CC"

mkdir -p ops/bin

# -----------------------------------------------------------------------------
# 1. Frontend Build
# -----------------------------------------------------------------------------
echo "--- Building Frontend ---"
cd frontend
pnpm install
pnpm run build
cd ..

# -----------------------------------------------------------------------------
# 2. Desktop Build
# -----------------------------------------------------------------------------
echo "--- Building Desktop App ---"

# Assets
rm -rf build/bin
mkdir -p build/bin

BASENAME="lokinode-desktop-${GOOS}-${GOARCH}"
ARCHIVE_NAME="lokinode-desktop-${GOOS}-${GOARCH}-${TAG}"
echo "ARCHIVE_NAME=${ARCHIVE_NAME}"

# Cleanup previous AppImages
rm -f *.AppImage*
rm -f ops/bin/*.AppImage*

# Wails Build (direct go build with wails tag — avoids wails CLI env issues in Docker)
echo "--- Building Desktop Binary ---"
go build -trimpath -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc -ldflags "-s -w" \
    -o "build/bin/${BASENAME}" .

# Packaging (AppImage)
echo "Packaging AppImage..."

# Setup AppDir
rm -rf AppDir
mkdir -p AppDir/usr/bin
mkdir -p AppDir/usr/share/applications
mkdir -p AppDir/usr/share/icons/hicolor/512x512/apps

if [ -f "build/bin/${BASENAME}" ]; then
    cp "build/bin/${BASENAME}" "AppDir/usr/bin/lokinode"
else
    echo "Error: Binary build/bin/${BASENAME} not found!"
    exit 1
fi

# Resize icon to 512x512 (linuxdeploy limit) if it's too large
if [ -f "build/AppIcon.png" ]; then
    convert "build/AppIcon.png" -resize 512x512 "AppDir/usr/share/icons/hicolor/512x512/apps/lokinode.png"
else
    echo "Warning: build/AppIcon.png not found"
fi

# Create Desktop File
cat > AppDir/usr/share/applications/lokinode.desktop <<EOF
[Desktop Entry]
Type=Application
Name=Lokinode
Comment=Flokicoin Node Manager
Exec=lokinode
Icon=lokinode
Categories=Utility;Network;Finance;
Terminal=false
EOF

export VERSION="${TAG}"
export APPIMAGE_EXTRACT_AND_RUN=1

if [ "$GOARCH" == "amd64" ]; then
    set -x
    "$LINUXDEPLOY_BIN" \
        --appdir AppDir \
        --output appimage \
        --icon-file AppDir/usr/share/icons/hicolor/512x512/apps/lokinode.png \
        --desktop-file AppDir/usr/share/applications/lokinode.desktop
    set +x

    mv Lokinode-*.AppImage "ops/bin/${ARCHIVE_NAME}.AppImage"

elif [ "$GOARCH" == "arm64" ]; then
    # Cross-Arch Manual Assembly
    rm -rf squashfs-root
    qemu-aarch64-static "$LINUXDEPLOY_BIN" --appimage-extract > /dev/null

    rm -f squashfs-root/usr/bin/linuxdeploy-plugin-appimage
    rm -f squashfs-root/usr/bin/patchelf
    echo '#!/bin/sh' > squashfs-root/usr/bin/patchelf
    echo 'exit 0' >> squashfs-root/usr/bin/patchelf
    chmod +x squashfs-root/usr/bin/patchelf

    qemu-aarch64-static squashfs-root/AppRun \
        --appdir AppDir \
        --icon-file AppDir/usr/share/icons/hicolor/512x512/apps/lokinode.png \
        --desktop-file AppDir/usr/share/applications/lokinode.desktop

    rm -rf squashfs-root

    echo "Creating squashfs payload..."
    rm -rf squashfs-root-tool
    "$APPIMAGETOOL_BIN" --appimage-extract > /dev/null
    mv squashfs-root squashfs-root-tool
    MKSQUASHFS=$(find squashfs-root-tool -name mksquashfs | head -n 1)

    "$MKSQUASHFS" AppDir filesystem.squashfs -root-owned -noappend -comp zstd -Xcompression-level 1

    echo "Assembling AppImage..."
    cat "$RUNTIME_BIN" filesystem.squashfs > "ops/bin/${ARCHIVE_NAME}.AppImage"
    chmod +x "ops/bin/${ARCHIVE_NAME}.AppImage"

    rm -rf squashfs-root-tool filesystem.squashfs
fi

# Cleanup
rm -rf AppDir

# -----------------------------------------------------------------------------
# 3. Native Packaging (DEB/RPM) via NFPM
# -----------------------------------------------------------------------------
echo "--- Native Packaging (DEB/RPM) ---"
if command -v nfpm >/dev/null 2>&1; then
    OS_ID=$(grep '^VERSION_CODENAME=' /etc/os-release | cut -d= -f2)
    echo "Detected Build Environment: $OS_ID"

    DEB_SUFFIX=""
    LIBWEBKIT="libwebkit2gtk-4.0-37"
    LIBWEBKIT_RPM="webkit2gtk3"

    if [ "$OS_ID" == "bookworm" ]; then
        echo "Configuring for Modern (Ubuntu 24.04+) naming..."
        DEB_SUFFIX="-ubuntu24.04"
        LIBWEBKIT="libwebkit2gtk-4.1-0"
        LIBWEBKIT_RPM="webkit2gtk4.1"
    fi

    TARGET_BINARY="lokinode-desktop-linux-${GOARCH}${DEB_SUFFIX}"
    cp "build/bin/${BASENAME}" "ops/bin/${TARGET_BINARY}"

    sed -e "s|\${GOARCH}|$GOARCH|g" \
        -e "s|\${TAG}|$TAG|g" \
        -e "s|\${BINARY_NAME}|$TARGET_BINARY|g" \
        -e "s|\${LIBWEBKIT}|$LIBWEBKIT|g" \
        -e "s|\${LIBWEBKIT_RPM}|$LIBWEBKIT_RPM|g" \
        ops/packaging/nfpm.yaml > ops/packaging/nfpm_eff.yaml

    DEB_NAME="lokinode-desktop-linux${DEB_SUFFIX}-${GOARCH}-${TAG}.deb"
    nfpm package --config ops/packaging/nfpm_eff.yaml --packager deb --target "ops/bin/${DEB_NAME}"

    RPM_ARCH="x86_64"
    if [ "$GOARCH" == "arm64" ]; then
        RPM_ARCH="aarch64"
    fi
    RPM_NAME="lokinode-desktop-linux${DEB_SUFFIX}-${RPM_ARCH}-${TAG}.rpm"
    nfpm package --config ops/packaging/nfpm_eff.yaml --packager rpm --target "ops/bin/${RPM_NAME}"

    APPIMAGE_ORIG="ops/bin/${ARCHIVE_NAME}.AppImage"
    if [ -n "$DEB_SUFFIX" ]; then
        NEW_APPIMAGE_NAME="lokinode-desktop-linux${DEB_SUFFIX}-${GOARCH}-${TAG}.AppImage"
        mv "${APPIMAGE_ORIG}" "ops/bin/${NEW_APPIMAGE_NAME}"
    fi

    rm "ops/bin/${TARGET_BINARY}"
    rm ops/packaging/nfpm_eff.yaml
else
    echo "Warning: nfpm not found. Skipping native packaging."
fi

echo "Build Complete. Artifacts in ops/bin:"
ls -lh ops/bin
