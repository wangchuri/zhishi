# 组装可运行的桌面目录：desktop/app/release/win-unpacked
#   release/win-unpacked/Zhishi.exe           (Electron 外壳)
#   release/win-unpacked/zhishi-backend/      (Python 后端，旁路目录)
#
# 用法（仓库根）：
#   powershell -ExecutionPolicy Bypass -File backend/packaging/assemble_desktop.ps1
#   powershell -ExecutionPolicy Bypass -File backend/packaging/assemble_desktop.ps1 -SkipBackend
#
# 前提：后端已经用 backend/packaging/build_backend.ps1 打过（desktop/zhishi-backend/ 里有 exe）

param(
  [switch]$SkipBackend,   # 跳过 PyInstaller（后端没改动时省 90 秒）
  [switch]$CopyBackend    # 复制后端而不是建 junction（要分发给别人时用）
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$Frontend = Join-Path $Root "frontend"
$App = Join-Path $Root "desktop\app"
$BackendSrc = Join-Path $Root "desktop\zhishi-backend"
$Unpacked = Join-Path $App "release\win-unpacked"

# ---- 1. 后端 ----
if (-not $SkipBackend) {
  Write-Host "==> Build Python backend (PyInstaller)"
  & (Join-Path $PSScriptRoot "build_backend.ps1")
  if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
}

if (-not (Test-Path (Join-Path $BackendSrc "zhishi-backend.exe"))) {
  Write-Error "Missing backend exe: $BackendSrc\zhishi-backend.exe（先跑 build_backend.ps1）"
}

# ---- 2. 前端产物（后端托管它，不进 Electron 包）----
Write-Host "==> Build frontend"
Push-Location $Frontend
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Pop-Location

# ---- 3. Electron ----
Write-Host "==> Build Electron shell"
Push-Location $App
if (-not (Test-Path "node_modules")) {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
}
if (-not (Test-Path "build\icon.ico")) {
  npm run icon
  if ($LASTEXITCODE -ne 0) { throw "icon generation failed" }
}
npm run pack
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
Pop-Location

if (-not (Test-Path (Join-Path $Unpacked "Zhishi.exe"))) {
  Write-Error "Missing $Unpacked\Zhishi.exe"
}

# ---- 4. 把后端放到 Electron 旁边 ----
$BackendDst = Join-Path $Unpacked "zhishi-backend"
if (Test-Path $BackendDst) {
  # junction 用 Remove-Item 删不掉，先 cmd rmdir
  cmd /c rmdir "$BackendDst" 2>$null
}
if ($CopyBackend) {
  Write-Host "==> Copy backend beside Electron"
  Copy-Item -Recurse -Force $BackendSrc $BackendDst
} else {
  Write-Host "==> Link backend beside Electron (junction, saves disk)"
  cmd /c mklink /J "$BackendDst" "$BackendSrc" | Out-Null
  if (-not (Test-Path (Join-Path $BackendDst "zhishi-backend.exe"))) {
    Write-Host "    junction failed, copying instead"
    Copy-Item -Recurse -Force $BackendSrc $BackendDst
  }
}

Write-Host ""
Write-Host "DONE"
Write-Host "  App:     $Unpacked\Zhishi.exe"
Write-Host "  Backend: $BackendDst\zhishi-backend.exe"
Write-Host "Run Zhishi.exe - it will start the backend on 127.0.0.1:7777."
