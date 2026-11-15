$ErrorActionPreference = 'Stop'

Write-Host 'Windows Build Script Started.'
if (-not $env:TAG) {
    if (Test-Path 'VERSION') {
        $env:TAG = (Get-Content 'VERSION').Trim()
    } else {
        Write-Error 'TAG environment variable is required.'
        exit 1
    }
}

Write-Host "TAG=$env:TAG"

New-Item -ItemType Directory -Force -Path 'ops/bin' | Out-Null
New-Item -ItemType Directory -Force -Path 'build' | Out-Null

Write-Host '--- Building Frontend ---'
Push-Location 'frontend'
try {
    pnpm install
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'pnpm build failed' }
} finally {
    Pop-Location
}

Write-Host '--- Building Desktop App ---'

if (-not (Test-Path 'build/AppIcon.png')) {
    Write-Warning 'build/AppIcon.png not found - Windows icon may be missing'
}
if (Test-Path 'ops/windows') {
    Copy-Item -Recurse 'ops/windows' 'build/' -Force
}

function Build-Desktop {
    param (
        [string]$Arch
    )
    $WailsPlatform = "windows/$Arch"
    $Basename = 'lokinode-windows'
    $ArchiveName = "lokinode-windows-$($env:TAG).zip"

    Write-Host "Building Desktop for $Arch..."

    if (Test-Path 'build/bin') {
        Remove-Item -Recurse -Force 'build/bin'
    }

    # The embedded flnd only compiles an RPC subserver when its build tag is
    # set, so this list - not flnd - decides what the shipped node serves.
    # signrpc is load-bearing: without it flnd serves a no-op signrpc.Signer
    # and lokihub cannot sign its transport announcement. Keep in step with the
    # dev set in the justfile; buildtags_test.go enforces the required tags are
    # present here.
    wails build -platform $WailsPlatform -webview2 embed -tags wails,walletrpc,chainrpc,invoicesrpc,routerrpc,peersrpc,signrpc -ldflags '-s -w' -nsis -o "${Basename}.exe" -clean

    if ($LASTEXITCODE -ne 0) { throw 'wails build failed' }

    Push-Location 'ops/bin'
    try {
        $SourceBin = "../../build/bin/${Basename}.exe"
        if (Test-Path $SourceBin) {
            Move-Item -Force $SourceBin 'lokinode.exe'
            Compress-Archive -Path 'lokinode.exe' -DestinationPath $ArchiveName -Force
            Remove-Item 'lokinode.exe'
        } else {
            Write-Warning "Output $SourceBin not found"
        }

        $InstallerSrc = '../../build/bin/lokinode-amd64-installer.exe'
        if (Test-Path $InstallerSrc) {
            $InstallerDst = "lokinode-windows-$($env:TAG)-installer.exe"
            Move-Item -Force $InstallerSrc $InstallerDst
            Write-Host "Installer: $InstallerDst"
        }
    } finally {
        Pop-Location
    }
}

Build-Desktop 'amd64'

Write-Host 'Windows Build Script Complete.'
Get-ChildItem 'ops/bin' | Select-Object Name, Length
