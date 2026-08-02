@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   知拾 - 前端开发服务
echo ================================================
echo.

if not exist "node_modules" (
    echo [提示] 未找到 node_modules，正在安装依赖...
    call npm install
    if errorlevel 1 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
    echo.
)

echo [启动] 本机:  http://127.0.0.1:5173
echo [局域网] 其他设备请访问:  http://<本机IP>:5173
echo [Electron] 另开终端运行 npm run electron:dev 可启动桌面版
echo [打包] 生成安装包:  npm run electron:build
echo [退出] 按 Ctrl+C 停止
echo ================================================
echo.

npm run dev

pause
