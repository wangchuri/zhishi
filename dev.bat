@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   知拾 - 本地开发启动
echo ================================================
echo.

REM 检测 Python 虚拟环境
if not exist ".venv\Scripts\python.exe" (
    echo [错误] 未找到 Python 虚拟环境 .venv
    echo 请先执行:
    echo   python -m venv .venv
    echo   .venv\Scripts\pip install -r backend\requirements.txt
    echo.
    pause
    exit /b 1
)

REM 检测前端依赖
if not exist "frontend\node_modules" (
    echo [提示] 未找到 frontend\node_modules，正在安装依赖...
    pushd frontend
    call npm install
    if errorlevel 1 (
        echo [错误] npm install 失败
        popd
        pause
        exit /b 1
    )
    popd
    echo.
)

echo [启动] 正在打开后端与前端窗口...
echo.

start "知拾-后端" cmd /k "cd /d ""%~dp0backend"" && call ""%~dp0.venv\Scripts\activate.bat"" && echo [后端] http://127.0.0.1:8765 && echo [文档] http://127.0.0.1:8765/docs && uvicorn server:app --host 127.0.0.1 --port 8765 --reload"

start "知拾-前端" cmd /k "cd /d ""%~dp0frontend"" && echo [前端] http://127.0.0.1:5173 && npm run dev"

echo ================================================
echo   访问地址
echo   前端: http://127.0.0.1:5173
echo   API:  http://127.0.0.1:8765/docs
echo ================================================
echo.
echo 已在独立窗口启动后端与前端，关闭对应窗口即可停止服务。
pause
