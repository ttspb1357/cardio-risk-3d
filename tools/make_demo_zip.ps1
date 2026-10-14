# Build a ready-to-share demo ZIP: every file tracked by git at HEAD, plus the built website (frontend/dist),
# so the receiver only needs Python (start.bat does the rest). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File tools\make_demo_zip.ps1 [-Out D:\Projects\CardioRisk3D-demo.zip]
param([string]$Out = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "CardioRisk3D-demo.zip"))
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (git status --porcelain --untracked-files=no) { throw "Commit your changes first: the ZIP is built from the last commit." }
if (-not (Test-Path "frontend\dist\index.html")) { throw "Build the website first: cd frontend; npm run build" }

# Windows' own bsdtar (by full path: other tar builds on PATH, e.g. MSYS, misread "D:" as a remote host).
# It also writes standard ZIPs with "/" separators, which unpack correctly on macOS too.
$tarExe = Join-Path $env:SystemRoot "System32\tar.exe"
$stage = Join-Path ([IO.Path]::GetTempPath()) ("cardiorisk-zip-" + [Guid]::NewGuid().ToString("N"))
$root = Join-Path $stage "CardioRisk3D"
New-Item -ItemType Directory -Force $root | Out-Null
try {
  $tar = Join-Path $stage "head.tar"
  git archive --format=tar -o $tar HEAD
  & $tarExe -xf $tar -C $root
  Remove-Item $tar
  Copy-Item -Recurse "frontend\dist" (Join-Path $root "frontend\dist")
  if (Test-Path $Out) { Remove-Item $Out }
  & $tarExe -a -cf $Out -C $stage "CardioRisk3D"
  if ($LASTEXITCODE -ne 0) { throw "tar failed" }
  $commit = git rev-parse --short HEAD
  "Created $Out ({0:N1} MB, commit $commit)" -f ((Get-Item $Out).Length / 1MB)
} finally {
  Remove-Item -Recurse -Force $stage
}
