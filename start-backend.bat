@echo off
chcp 65001 >nul
echo.
echo ======================================
echo   Windsurf Helper 本地后端安装 ^& 启动
echo ======================================
echo.

cd /d "%~dp0backend"

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] npm install 失败
    pause
    exit /b 1
)

:: 检查配置文件
if not exist "backend-config.js" (
    echo.
    echo [2/3] 创建配置文件...
    copy backend-config.example.js backend-config.js
    echo.
    echo [!] 请先编辑 backend\backend-config.js 填写你的 QQ 邮箱信息！
    echo     - QQ_EMAIL:     你的 QQ 邮箱地址
    echo     - QQ_AUTH_CODE: QQ 邮箱授权码（不是 QQ 密码）
    echo     - DOMAIN:       你的域名（已在 Cloudflare 配置转发）
    echo.
    start notepad backend-config.js
    pause
    exit /b 0
) else (
    echo [2/3] 配置文件已存在，跳过
)

echo.
echo [3/3] 启动后端服务...
echo.
node server.js
pause
