@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================
echo   CorineKit Pix2Real - Debug Mode
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

echo Checking port 5173...
netstat -ano 2>nul | findstr ":5173 " | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [\!] Port 5173 in use, releasing...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING"') do (
        taskkill /F /PID %%a >nul 2>&1
        echo     Killed PID %%a
    )
) else (
    echo [ok] Port 5173 free
)
echo.

echo Starting server (localhost:3000)...
start "Pix2Real-Server" cmd /k "chcp 65001 >nul && cd server && npm run dev"

echo Waiting 3s for server...
timeout /t 3 /nobreak >nul

echo Starting client (localhost:5173)...
start "Pix2Real-Client" cmd /k "chcp 65001 >nul && cd client && npm run dev"

echo Waiting 5s for client...
timeout /t 5 /nobreak >nul

echo Opening browser...
start "" "http://localhost:5173"

echo.
echo ======================================
echo   Done^^! http://localhost:5173
echo   Run stop.bat to stop services.
echo ======================================
echo.
pause
