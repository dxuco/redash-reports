@echo off
title Step 6 - publish to the web
cd /d "%~dp0"

echo.
echo   Publishing the report as a Cloudflare Worker.
echo   It checks the password itself, so no Zero Trust and no card needed.
echo   The first run downloads wrangler, so give it a minute.
echo.

node publish-worker.js

echo.
pause
