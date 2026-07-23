@echo off
chcp 65001 >nul 2>&1
title EasyLoop

echo ========================================
echo   EasyLoop - Windows Launcher
echo ========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js가 설치되어 있지 않습니다.
    echo.
    echo 다운로드: https://nodejs.org
    echo LTS 버전을 설치한 후 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo [OK] Node.js %NODE_VER% detected

:: Install dependencies if needed
if not exist "node_modules" (
    echo.
    echo [SETUP] Installing dependencies...
    call npm install --production
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
)

echo.
echo ========================================
echo   Starting EasyLoop server
echo ========================================
echo.

:: Start server and open the browser on the port actually selected
node launcher.js

pause
