@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [错误] 未找到 .venv。请先在仓库根目录运行 install.bat
    exit /b 1
)

echo 知拾后端  http://127.0.0.1:7777
echo 开发前端请另开终端:  cd frontend ^&^& npm run dev
echo.
cd backend
"..\.venv\Scripts\python.exe" -m src.main
