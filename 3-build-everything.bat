@echo off
title Step 3 - full build
cd /d "%~dp0"

echo.
echo   Building every month in config.env, then checking the result
echo   against the numbers in your original report.
echo.
echo   This is the slow one - query 1732 returns roughly a million rows
echo   across the full range. Leave the window open.
echo.

REM Tee to build-last.log so a failure can be read after the window closes.
node build.js --verify > build-last.log 2>&1
set "BONUS_RC=%ERRORLEVEL%"
type build-last.log
if not "%BONUS_RC%"=="0" echo.  ^&^& echo   ** The build FAILED - the error is above, and in build-last.log

echo.
echo   If the check above looks right, run  start.bat  and open
echo   http://localhost:8080
echo.
pause
