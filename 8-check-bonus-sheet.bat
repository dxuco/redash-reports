@echo off
title Check the bonus categorisation sheet
cd /d "%~dp0"

echo.
echo   Reading the bonus categorisation file from Google Drive.
echo   Takes a few seconds. Nothing else is rebuilt.
echo.

node build.js --groups > check-bonus-sheet.log 2>&1
type check-bonus-sheet.log

echo.
pause
