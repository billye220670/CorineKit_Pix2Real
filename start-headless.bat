@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ======================================================================
rem  Headless 模式 = 仅启动后端 API 服务 (localhost:3000)
rem  - 不启动前端 UI (5173)
rem  - 不打开浏览器
rem  - 供外部程序/测试工具调用对外 API /api/v1
rem ======================================================================

echo ======================================
echo   CorineKit Pix2Real - Headless (API only)
echo ======================================
echo.

echo Checking port 3000...
netstat -ano 2>nul | findstr ":3000 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [\!] Port 3000 in use, releasing...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a >nul 2>&1
        echo     Killed PID %%a
    )
) else (
    echo [ok] Port 3000 free
)
echo.

echo Starting server (localhost:3000)...
start "Pix2Real-Server" powershell -WindowStyle Hidden -NoProfile -Command "Set-Location '%~dp0server'; npm run dev"

echo Waiting 3s for server...
timeout /t 3 /nobreak >nul

echo.
echo ======================================
echo   Done^^\! Backend API only (no UI)
echo   API: http://localhost:3000/api/v1
echo   Run stop.bat to stop services.
echo ======================================
echo.
timeout /t 2 /nobreak >nul
