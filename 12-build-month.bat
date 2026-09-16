@echo off
setlocal
title Step 12 - build this month's FTD Performance page
cd /d "%~dp0ftd-report"

REM Builds the monthly FTD Performance page on its own. UPDATE-EVERYTHING.bat
REM already does this as step 3, so you only need it here when you want that
REM one page rebuilt without touching anything else.
REM
REM No month to edit: it builds whichever month we are in, and names the file
REM after it. Pass a month to rebuild an older one, e.g.
REM
REM     12-build-month.bat 2026-07

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM"') do set "MONTH=%%i"
if not "%~1"=="" set "MONTH=%~1"

echo.
echo   Building the FTD Performance page for %MONTH%.
echo   Pulls %MONTH% from Redash if the cache does not already have it,
echo   then compares against the prior month and the prior year.
echo.

node --max-old-space-size=6000 build-month.js --month=%MONTH%
if errorlevel 1 goto failed

node --max-old-space-size=6000 make-month-html.js --month=%MONTH%
if errorlevel 1 goto failed

echo.
echo   Done. Publish it with  6-publish.bat
goto end

:failed
echo.
echo   Build failed. Nothing was overwritten - the previous page is still there.
echo   (If Redash could not connect, check the VPN and run this again.)

:end
echo.
pause
endlocal
