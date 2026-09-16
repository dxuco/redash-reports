@echo off
title Step 9 - refresh the FTD cache from Redash
cd /d "%~dp0ftd-report"

REM Pulls August 2026 from Redash (query 1732) straight into cache\2026-08.json.
REM No CSV, no browser, no download. The API key comes from config.env.
REM
REM --no-cache forces a fresh pull instead of reusing what is on disk, which is
REM what you want after the KEEP list changed: the cache now also carries
REM player_status, deposit_count, bonus_group, bonus_name and game_id.
REM
REM After this runs once, your nightly build keeps the cache current on its own
REM and this step is not needed again.

echo.
echo   Refreshing cache\2026-08.json from Redash.
echo   ~70,000 rows. A minute or two. Dots mean it is working.
echo.

node build-ftd.js --month=2026-08 --no-cache
if errorlevel 1 goto failed

echo.
echo   Done. Tell Claude the cache is refreshed.
goto end

:failed
echo.
echo   Failed. If it could not connect, check the VPN, then run this again.

:end
echo.
pause
