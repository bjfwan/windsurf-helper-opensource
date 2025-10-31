@echo off
echo ========================================
echo  Windsurf Helper - Setup Script
echo ========================================
echo.

echo [1/2] Copying configuration files...
if not exist "extension\email-config.js" (
    copy "extension\email-config.example.js" "extension\email-config.js" >nul
    echo [OK] Created email-config.js
) else (
    echo [SKIP] email-config.js already exists
)

if not exist "extension\config.js" (
    copy "extension\config.example.js" "extension\config.js" >nul
    echo [OK] Created config.js
) else (
    echo [SKIP] config.js already exists
)

echo.
echo [2/2] Setup completed!
echo.
echo ========================================
echo  Next steps:
echo ========================================
echo 1. Open Edge browser
echo 2. Go to edge://extensions/
echo 3. Enable "Developer mode"
echo 4. Click "Load unpacked"
echo 5. Select the "extension" folder
echo.
echo Press any key to exit...
pause >nul
