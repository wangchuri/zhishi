$ErrorActionPreference = "Stop"
$Root = "D:\development\projects\zhishi"
$DstRoot = Join-Path $Root "desktop\Zhishi\zhishi-backend"
$SrcDbDir = Join-Path $Root "data"
$DstDbDir = Join-Path $DstRoot "data"
$SrcStorage = Join-Path $Root "backend\storage"
$DstStorage = Join-Path $DstRoot "storage"

Write-Host "Stop running app if any..."
Get-Process -Name "Zhishi","zhishi-backend" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

New-Item -ItemType Directory -Force -Path $DstDbDir | Out-Null
New-Item -ItemType Directory -Force -Path $DstStorage | Out-Null

Write-Host "Copy database..."
Get-ChildItem $DstDbDir -Filter "zhishi.db*" -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item (Join-Path $SrcDbDir "zhishi.db") (Join-Path $DstDbDir "zhishi.db") -Force
foreach ($ext in @(".db-wal", ".db-shm")) {
  $f = Join-Path $SrcDbDir ("zhishi" + $ext)
  if (Test-Path $f) { Copy-Item $f (Join-Path $DstDbDir ("zhishi" + $ext)) -Force }
}

$dbSize = (Get-Item (Join-Path $DstDbDir "zhishi.db")).Length
Write-Host ("  DB size: {0:N1} MB" -f ($dbSize / 1MB))

Write-Host "Copy storage (documents/images/chroma)..."
robocopy $SrcStorage $DstStorage /E /R:2 /W:1 /MT:8 | Out-Null
$code = $LASTEXITCODE
if ($code -ge 8) { throw "robocopy failed with code $code" }

$stSize = (Get-ChildItem $DstStorage -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
Write-Host ("  Storage size: {0:N1} MB" -f ($stSize / 1MB))
Write-Host "DONE"
Write-Host "Target: $DstRoot"
