# 知拾 - 本地开发启动（PowerShell）
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = $PSScriptRoot

Write-Host "================================================"
Write-Host "  知拾 - 本地开发启动"
Write-Host "================================================"
Write-Host ""

# 检测 Python 虚拟环境
$venvPython = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "[错误] 未找到 Python 虚拟环境 .venv"
    Write-Host "请先执行:"
    Write-Host "  python -m venv .venv"
    Write-Host "  .venv\Scripts\pip install -r backend\requirements.txt"
    Write-Host ""
    Read-Host "按 Enter 退出"
    exit 1
}

# 检测前端依赖
$nodeModules = Join-Path $Root "frontend\node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host "[提示] 未找到 frontend\node_modules，正在安装依赖..."
    Push-Location (Join-Path $Root "frontend")
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[错误] npm install 失败"
        Pop-Location
        Read-Host "按 Enter 退出"
        exit 1
    }
    Pop-Location
    Write-Host ""
}

Write-Host "[启动] 正在打开后端与前端窗口..."
Write-Host ""

$backendDir = Join-Path $Root "backend"
$activateBat = Join-Path $Root ".venv\Scripts\activate.bat"
$frontendDir = Join-Path $Root "frontend"

$backendCmd = "cd /d `"$backendDir`" && call `"$activateBat`" && echo [后端] http://127.0.0.1:8765 && echo [文档] http://127.0.0.1:8765/docs && uvicorn server:app --host 127.0.0.1 --port 8765 --reload"
Start-Process cmd -ArgumentList "/k", $backendCmd -WindowStyle Normal

$frontendCmd = "cd /d `"$frontendDir`" && echo [前端] http://127.0.0.1:5173 && npm run dev"
Start-Process cmd -ArgumentList "/k", $frontendCmd -WindowStyle Normal

Write-Host "================================================"
Write-Host "  访问地址"
Write-Host "  前端: http://127.0.0.1:5173"
Write-Host "  API:  http://127.0.0.1:8765/docs"
Write-Host "================================================"
Write-Host ""
Write-Host "已在独立窗口启动后端与前端，关闭对应窗口即可停止服务。"
Read-Host "按 Enter 关闭本窗口"
