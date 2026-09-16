@echo off
title Rebuild bonus cost data
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on your PATH.
  echo   Install it from https://nodejs.org ^(LTS^), then run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Rebuilding data.json from Redash. This runs both queries for
echo   every month in the range, so it takes a while. Leave it running.
echo.

node build.js --verify

echo.
pause
