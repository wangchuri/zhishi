# Build zhishi-backend.exe for Electron（ASCII only）
#
# 产物：desktop/zhishi-backend/{zhishi-backend.exe,_internal,...}
#
# 注意：PyInstaller 的 --noconfirm 会**整个删掉** --distpath 下的同名目录。
# 所以这里先打到 desktop/_newbackend，再只覆盖程序文件，
# 保留 desktop/zhishi-backend 里的 storage/ data/ tina.env（用户数据和配置）。

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

$Spec = Join-Path $Root "backend\packaging\zhishi-backend.spec"
$Staging = Join-Path $Root "desktop\_newbackend"
$Work = Join-Path $Root "desktop\build"
$Final = Join-Path $Root "desktop\zhishi-backend"

Remove-Item $Staging -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "==> PyInstaller (this may take a few minutes)"
& $Py -m PyInstaller $Spec --noconfirm --distpath $Staging --workpath $Work
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

$NewExe = Join-Path $Staging "zhishi-backend\zhishi-backend.exe"
if (-not (Test-Path $NewExe)) { Write-Error "Missing output: $NewExe" }

Write-Host "==> Merge into desktop\zhishi-backend (keep storage/ data/ tina.env)"
New-Item -ItemType Directory -Force -Path $Final | Out-Null
Remove-Item (Join-Path $Final "_internal") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $NewExe (Join-Path $Final "zhishi-backend.exe") -Force
Copy-Item (Join-Path $Staging "zhishi-backend\_internal") (Join-Path $Final "_internal") -Recurse -Force
foreach ($f in @("config.yml.example", "tina.env.example")) {
  $src = Join-Path $Staging "zhishi-backend\$f"
  if (Test-Path $src) { Copy-Item $src (Join-Path $Final $f) -Force }
}

$EnvSrc = Join-Path $Root "backend\tina.env"
$EnvDst = Join-Path $Final "tina.env"
if ((Test-Path $EnvSrc) -and -not (Test-Path $EnvDst)) {
  Copy-Item $EnvSrc $EnvDst
  Write-Host "==> Copied tina.env next to exe"
}

Remove-Item $Staging -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $Work -Recurse -Force -ErrorAction SilentlyContinue

$Size = (Get-ChildItem $Final -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch "\\storage\\|\\data\\|\\logs\\" } |
  Measure-Object Length -Sum).Sum
Write-Host ""
Write-Host ("DONE: {0}  (program files {1:N1} MB)" -f (Join-Path $Final "zhishi-backend.exe"), ($Size / 1MB))
Write-Host "Next: powershell -File backend/packaging/assemble_desktop.ps1 -SkipBackend"
