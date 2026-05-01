$ErrorActionPreference = "Stop"

Write-Host "Windows Build Script Started."
if (-not $env:TAG) {
    if (Test-Path "VERSION") {
        $env:TAG = (Get-Content "VERSION").Trim()
    } else {
        Write-Error "TAG environment variable is required."
        exit 1
    }
}

Write-Host "TAG=$env:TAG"

New-Item -ItemType Directory -Force -Path "ops/bin" | Out-Null
New-Item -ItemType Directory -Force -Path "build" | Out-Null

# -----------------------------------------------------------------------------
# 1. Frontend Build
# -----------------------------------------------------------------------------
Write-Host "--- Building Frontend ---"
Push-Location "frontend"
try {
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }
} finally {
    Pop-Location
}

# -----------------------------------------------------------------------------
# 2. Build Desktop (Native)
# -----------------------------------------------------------------------------
Write-Host "--- Building Desktop App ---"

if (-not (Test-Path "build/AppIcon.png")) {
    Write-Warning "build/AppIcon.png not found - Windows icon may be missing"
}
if (Test-Path "ops/windows") {
    Copy-Item -Recurse "ops/windows" "build/" -Force
}

function Build-Desktop {
    param (
        [string]$Arch
    )
    $WailsPlatform = "windows/$Arch"
    $Basename = "lokinode-desktop-windows"
    $ArchiveName = "lokinode-desktop-windows-$($env:TAG).zip"

    Write-Host "Building Desktop for $Arch..."

    if (Test-Path "build/bin") {
        Remove-Item -Recurse -Force "build/bin"
    }

    # Run wails build on a single line to avoid backtick issues
    wails build -platform $WailsPlatform -webview2 embed -tags wails -ldflags "-s -w" -nsis -o "${Basename}.exe" -clean

    if ($LASTEXITCODE -ne 0) { throw "wails build failed" }

    Push-Location "ops/bin"
    try {
        $SourceBin = "../../build/bin/${Basename}.exe"
        if (Test-Path $SourceBin) {
            Move-Item -Force $SourceBin "lokinode.exe"
            Compress-Archive -Path "lokinode.exe" -DestinationPath $ArchiveName -Force
            Remove-Item "lokinode.exe"
        } else {
            Write-Warning "Output $SourceBin not found"
        }

        # Copy NSIS installer if produced
        $InstallerSrc = "../../build/bin/lokinode-amd64-installer.exe"
        if (Test-Path $InstallerSrc) {
            $InstallerDst = "lokinode-desktop-windows-$($env:TAG)-installer.exe"
            Move-Item -Force $InstallerSrc $InstallerDst
            Write-Host "Installer: $InstallerDst"
        }
    } finally {
        Pop-Location
    }
}

Build-Desktop "amd64"

Write-Host "Windows Build Script Complete."
Get-ChildItem "ops/bin" | Select-Object Name, Length
