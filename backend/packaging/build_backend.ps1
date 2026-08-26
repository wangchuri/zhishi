# Build zhishi-backend.exe for Electron (ASCII only)
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$Py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $Py)) {
  Write-Error "Python venv not found: $Py"
}

Write-Host "==> Ensure PyInstaller"
& $Py -m pip install -q "pyinstaller>=6.0"
if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller failed" }

$DistIndex = Join-Path $Root "frontend\dist\index.html"
if (-not (Test-Path $DistIndex)) {
  Write-Host "==> Build frontend"
  Push-Location (Join-Path $Root "frontend")
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
  Pop-Location
}

$OutRoot = Join-Path $Root "desktop"
New-Item -ItemType Directory -Force -Path $OutRoot | Out-Null

$Spec = Join-Path $Root "backend\packaging\zhishi-backend.spec"
$DistPath = Join-Path $OutRoot "."
$WorkPath = Join-Path $OutRoot "build"

Write-Host "==> PyInstaller (this may take a long time)"
& $Py -m PyInstaller $Spec --noconfirm --distpath $DistPath --workpath $WorkPath
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$Exe = Join-Path $OutRoot "zhishi-backend\zhishi-backend.exe"
if (-not (Test-Path $Exe)) {
  Write-Error "Missing output: $Exe"
}

$EnvSrc = Join-Path $Root "backend\tina.env"
$EnvDst = Join-Path $OutRoot "zhishi-backend\tina.env"
if ((Test-Path $EnvSrc) -and -not (Test-Path $EnvDst)) {
  Copy-Item $EnvSrc $EnvDst
  Write-Host "==> Copied tina.env next to exe"
}

Write-Host ""
Write-Host "DONE: $Exe"
Write-Host "Next: double-click the launcher bat in repo root"
