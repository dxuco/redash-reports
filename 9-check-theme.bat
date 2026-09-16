@echo off
setlocal
cd /d "%~dp0"

echo.
echo   Checking every report against the house palette in theme.css
echo.

node check-theme.js > check-theme.log 2>&1
set RC=%ERRORLEVEL%
type check-theme.log

if %RC% NEQ 0 (
  echo.
  echo   ^>^> Some colours are off-palette. See the list above.
) else (
  echo   ^>^> All reports match.
)

echo.
echo   (this output is also saved in check-theme.log)
echo.
pause
