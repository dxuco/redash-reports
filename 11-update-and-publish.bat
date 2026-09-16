@echo off
title One click - refresh data, rebuild reports, publish the site
cd /d "%~dp0"

REM Figure out the current month (so this works in September without edits).
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM"') do set MONTH=%%i

echo.
echo   ==[ 1/3 ]=====================================================
echo   Refreshing the Redash cache for %MONTH% (a minute or two)...
echo.
pushd ftd-report
node build-ftd.js --month=%MONTH% --no-cache
if errorlevel 1 ( popd & goto failed )
popd

echo.
echo   ==[ 2/3 ]=====================================================
echo   Building the Acquisition ^& CPA report
echo   (cost sheet is downloaded live from Google Drive)...
echo.
where python >nul 2>&1
if %errorlevel%==0 (set PY=python) else (set PY=py -3)
%PY% -m pip install openpyxl --quiet --disable-pip-version-check >nul 2>&1
%PY% "acquisition-report\build_acquisition.py"
if errorlevel 1 goto failed

echo.
echo   ==[ 3/3 ]=====================================================
echo   Publishing to the web...
echo.
node publish-worker.js
if errorlevel 1 goto failed

echo.
echo   ==============================================================
echo   All done - the site is fully updated.
echo   ==============================================================
goto end

:failed
echo.
echo   Something failed - see the messages above.
echo   (If Redash could not connect, check the VPN and run this again.)

:end
echo.
pause
