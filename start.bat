@echo off
setlocal

if "%PHP_CLI_SERVER_WORKERS%"=="" set PHP_CLI_SERVER_WORKERS=4
if "%PORT%"=="" set PORT=8080
if "%HOST%"=="" set HOST=0.0.0.0

cd /d "%~dp0"

echo Iniciando Waze Places em http://%HOST%:%PORT%
echo Workers: %PHP_CLI_SERVER_WORKERS%
echo Para parar, aperte Ctrl+C
echo.

php -S %HOST%:%PORT%
