@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title EasyLoop develop - 192.168.30 LAN
cd /d "%~dp0"

if not exist "%~dp0EasyLoop.exe" (
    echo [ERROR] EasyLoop.exe 파일이 없습니다.
    echo 이 배치 파일을 EasyLoop.exe와 같은 폴더에 두세요.
    pause
    exit /b 1
)

:: Windows 방화벽 설정에는 관리자 권한이 필요합니다.
net session >nul 2>&1
if errorlevel 1 (
    echo [INFO] 192.168.30.0/24 접속 허용을 위해 관리자 권한으로 다시 실행합니다.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

set "PORT=3000"
set "EASYLOOP_STRICT_PORT=1"
set "EASYLOOP_LAN_PREFIX=192.168.30."
set "EASYLOOP_LAN_IP="

for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$ip = Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -like '192.168.30.*' } ^| Select-Object -First 1 -ExpandProperty IPAddress; if ($ip) { $ip }"`) do set "EASYLOOP_LAN_IP=%%I"

if defined EASYLOOP_LAN_IP goto LAN_READY

echo.
echo [WARN] Windows에 192.168.30.x 주소가 없습니다.
echo 로봇망에 연결된 어댑터에는 현재 DHCP 주소 대신 169.254.x.x만 있습니다.
echo 사용할 주소가 다른 장비와 중복되지 않는지 확인하세요.
set /p "EASYLOOP_LAN_IP=이 PC에 사용할 주소를 입력하세요 [기본 192.168.30.39]: "
if not defined EASYLOOP_LAN_IP set "EASYLOOP_LAN_IP=192.168.30.39"

echo [SETUP] %EASYLOOP_LAN_IP%/24 주소를 로봇망 어댑터에 적용합니다.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$requested=$env:EASYLOOP_LAN_IP; if ($requested -notmatch '^192\.168\.30\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$') { exit 3 }; $adapter = Get-NetAdapter ^| Where-Object { $_.Status -eq 'Up' -and $_.HardwareInterface } ^| Where-Object { $idx=$_.ifIndex; @(Get-NetIPAddress -InterfaceIndex $idx -AddressFamily IPv4 -ErrorAction SilentlyContinue ^| Where-Object { $_.IPAddress -like '169.254.*' }).Count -gt 0 } ^| Select-Object -First 1; if (-not $adapter) { exit 4 }; New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress $requested -PrefixLength 24 -PolicyStore ActiveStore -ErrorAction Stop ^| Out-Null; Set-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -NetworkCategory Private -ErrorAction SilentlyContinue"
if errorlevel 1 (
    echo [ERROR] 192.168.30.x 주소를 적용하지 못했습니다.
    echo 로봇망 Wi-Fi 연결과 입력 주소를 확인하세요.
    pause
    exit /b 1
)

:LAN_READY

echo [SETUP] Windows 방화벽에서 192.168.30.0/24 EasyLoop 접속을 허용합니다.
netsh advfirewall firewall delete rule name="EasyLoop LAN 192.168.30" >nul 2>&1
netsh advfirewall firewall add rule name="EasyLoop LAN 192.168.30" dir=in action=allow program="%~dp0EasyLoop.exe" enable=yes profile=any protocol=TCP remoteip=192.168.30.0/24 >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Windows 방화벽 규칙을 추가하지 못했습니다.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   EasyLoop develop 공유용
echo ========================================
echo   접속 주소: http://%EASYLOOP_LAN_IP%:3000
echo   종료: 이 창에서 Ctrl+C
echo ========================================
echo.

"%~dp0EasyLoop.exe"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [ERROR] EasyLoop가 종료되었습니다. Exit code: %EXIT_CODE%
    echo 포트 3000을 사용하는 다른 EasyLoop가 있는지 확인하세요.
    pause
)
exit /b %EXIT_CODE%
