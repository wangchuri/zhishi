# Assemble portable desktop app:
#   desktop/Zhishi/Zhishi.exe          (Electron frontend)
#   desktop/Zhishi/zhishi-backend/     (Python backend, side-by-side)
#
# Usage (repo root):
#   powershell -ExecutionPolicy Bypass -File backend/packaging/assemble_desktop.ps1

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$Frontend = Join-Path $Root "frontend"
$BackendSrc = Join-Path $Root "desktop\zhishi-backend"
$Out = Join-Path $Root "desktop\Zhishi"

if (-not (Test-Path (Join-Path $BackendSrc "zhishi-backend.exe"))) {
  Write-Error "Missing backend exe: $BackendSrc\zhishi-backend.exe"
}

Write-Host "==> Build Electron frontend (no backend inside)"
Push-Location $Frontend
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
npm run electron:compile
if ($LASTEXITCODE -ne 0) { throw "electron compile failed" }
npx electron-builder --win dir --x64
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
Pop-Location

$Unpacked = Join-Path $Frontend "release\win-unpacked"
if (-not (Test-Path $Unpacked)) {
  Write-Error "Missing $Unpacked"
}

Write-Host "==> Assemble desktop\Zhishi"
if (Test-Path $Out) {
  Remove-Item -Recurse -Force $Out
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null
Copy-Item -Recurse -Force (Join-Path $Unpacked "*") $Out

$BackendDst = Join-Path $Out "zhishi-backend"
if (Test-Path $BackendDst) {
  Remove-Item -Recurse -Force $BackendDst
}
Write-Host "==> Copy backend beside Electron (junction if possible)"
try {
  cmd /c mklink /J "$BackendDst" "$BackendSrc" | Out-Null
  if (-not (Test-Path (Join-Path $BackendDst "zhishi-backend.exe"))) { throw "junction failed" }
  Write-Host "    using directory junction (saves disk)"
} catch {
  Write-Host "    junction failed, copying files..."
  Copy-Item -Recurse -Force $BackendSrc $BackendDst
}

$Exe = Join-Path $Out "Zhishi.exe"
if (-not (Test-Path $Exe)) {
  # older build may use Chinese name
  $Alt = Get-ChildItem $Out -Filter "*.exe" | Where-Object { $_.Name -ne "zhishi-backend.exe" } | Select-Object -First 1
  if ($Alt) { $Exe = $Alt.FullName }
}

Write-Host ""
Write-Host "DONE"
Write-Host "  App: $Exe"
Write-Host "  Backend: $BackendDst\zhishi-backend.exe"
Write-Host "Run Zhishi.exe — it will find and start the backend next to it."
