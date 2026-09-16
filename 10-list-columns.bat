@echo off
setlocal
cd /d "%~dp0"

echo.
echo   Asking Redash which columns queries 1732 and 1731 return.
echo   The VPN needs to be up. This takes under a minute.
echo.

node list-columns.js > list-columns.log 2>&1
type list-columns.log

echo.
echo   (also saved to list-columns.log)
echo.
pause
