@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ================================================
echo   知拾 — 安装依赖
echo ================================================
echo.

set "PY="
where py >nul 2>&1
if %ERRORLEVEL%==0 (
    py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)" >nul 2>&1
    if %ERRORLEVEL%==0 set "PY=py -3"
)
if not defined PY (
    where python >nul 2>&1
    if %ERRORLEVEL%==0 set "PY=python"
)
if not defined PY (
    echo [错误] 未找到 Python。请安装 Python 3.12（或 3.11），并勾选 Add python.exe to PATH。
    echo        https://www.python.org/downloads/
    exit /b 1
)

%PY% -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)"
if errorlevel 1 (
    echo [错误] 需要 Python 3.11 或 3.12，当前版本过低。
    %PY% -c "import sys; print(sys.version)"
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 npm。请安装 Node.js 20 或 22。
    echo        https://nodejs.org/
    exit /b 1
)

echo [1/4] 创建虚拟环境 .venv
if not exist ".venv\Scripts\python.exe" (
    %PY% -m venv .venv
    if errorlevel 1 (
        echo [错误] 创建 venv 失败
        exit /b 1
    )
) else (
    echo       已存在，跳过创建
)

echo [2/4] 安装 Python 依赖（必须在 backend 目录，才能找到 Tina wheel）
echo       含本地向量模型用的 PyTorch，默认是 CPU 版，不需要 CUDA。
call ".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 exit /b 1
pushd backend
call "..\.venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    popd
    echo [错误] pip install 失败
    exit /b 1
)
popd

echo [3/4] 安装前端依赖
pushd frontend
call npm ci
if errorlevel 1 (
    echo       npm ci 失败，改试 npm install
    call npm install
    if errorlevel 1 (
        popd
        echo [错误] npm 安装失败
        exit /b 1
    )
)
popd

echo [4/4] 准备 tina.env
if not exist "backend\tina.env" (
    if exist "backend\tina.env.example" (
        copy /Y "backend\tina.env.example" "backend\tina.env" >nul
        echo       已复制 backend\tina.env.example → backend\tina.env
        echo       请编辑该文件，填入 LLM_API_KEY 后再启动对话功能。
    ) else (
        echo       [警告] 没有 tina.env.example，请自行创建 backend\tina.env
    )
) else (
    echo       backend\tina.env 已存在，未覆盖
)

echo.
echo 安装完成。不需要 NVIDIA / CUDA。
echo 下一步：
echo   1. 编辑 backend\tina.env，填入 DeepSeek API 密钥
echo   2. 运行 start.bat 启动后端  ^(http://127.0.0.1:7777^)
echo   3. 开发前端：另开终端 cd frontend ^&^& npm run dev  ^(http://127.0.0.1:5173^)
echo.
exit /b 0
