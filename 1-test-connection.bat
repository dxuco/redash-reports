@echo off
title Step 1 - test connection
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Get it from https://nodejs.org ^(LTS^).
  echo.
  pause
  exit /b 1
)

echo.
echo   Checking that both Redash queries answer and both API keys work.
echo   This runs a tiny 2-day query, so it should finish in under a minute.
echo.

node build.js --probe

echo.
echo   Both queries should say OK above.
echo   If they do, run  2-test-one-month.bat  next.
echo.
pause
