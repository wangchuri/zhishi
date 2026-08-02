@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   知拾 - 后端服务
echo ================================================
echo.

if not exist "..\.venv\Scripts\python.exe" (
    echo [错误] 未找到 ..\.venv\Scripts\python.exe
    echo 请在项目根目录创建虚拟环境:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

call "..\.venv\Scripts\activate.bat"

set "LAN_IP="
for /f "delims=" %%i in ('python -c "import make_cert;print(make_cert.detect_lan_ip())"') do set "LAN_IP=%%i"
if "%LAN_IP%"=="" set "LAN_IP=<本机IP>"

echo [本机]   http://127.0.0.1:8765  （前端网页 + API）
echo [局域网] http://%LAN_IP%:8765
echo [文档]   http://127.0.0.1:8765/docs
echo [提示]   Windows 桌面版可用 Electron 打包（frontend\npm run electron:build）
echo [退出]   Ctrl+C 停止
echo ================================================
echo.

python server.py

pause
