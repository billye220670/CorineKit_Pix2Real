@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ======================================
echo   CorineKit Pix2Real - Stop Dev
echo ======================================
echo.

set "killed=0"

echo Checking port 3000 (server)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo [ok] Killed PID %%a (server)
    set "killed=1"
)
if "%killed%"=="0" echo     No server found on port 3000

set "killed2=0"
echo Checking port 5173 (client)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo [ok] Killed PID %%a (client)
    set "killed2=1"
)
if "%killed2%"=="0" echo     No client found on port 5173

set "killed3=0"
echo Checking port 8188 (ComfyUI)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8188 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    echo [ok] Killed PID %%a (ComfyUI)
    set "killed3=1"
)
if "%killed3%"=="0" echo     No ComfyUI found on port 8188

echo.
if "%killed%%killed2%%killed3%"=="000" (
    echo No services were running.
) else (
    echo All services stopped.
)
echo.
timeout /t 2 /nobreak >nul
