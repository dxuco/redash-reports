@echo off
title Redash page
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on your PATH.
  echo   Install it from https://nodejs.org  ^(the LTS version^), then run this again.
  echo.
  pause
  exit /b 1
)

node server.js

echo.
echo   The server stopped.
pause
