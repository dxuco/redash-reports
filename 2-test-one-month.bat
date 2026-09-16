@echo off
title Step 2 - test one month
cd /d "%~dp0"

echo.
echo   Building August 2026 only, into data.test.json.
echo   Your real data.json is not touched.
echo.
echo   This runs the full pipeline on one month, so if it works here it
echo   will work for the whole range - it will just take longer.
echo.

node build.js --from=2026-08 --to=2026-08 --out=data.test.json

echo.
echo   Check the numbers printed above look sane, then run
echo   3-build-everything.bat
echo.
pause
