@echo off
title Step 4 - which segment column
cd /d "%~dp0"

echo.
echo   Query 1732 has three segment columns. This runs January only and
echo   compares all three against the numbers in your original report,
echo   to find out which one the report was segmented by.
echo.
echo   Takes about a minute. Nothing is written to disk.
echo.

node build.js --segprobe --from=2026-01 --to=2026-01

echo.
pause
