@echo off
title Step 10 - build the Acquisition ^& CPA report
cd /d "%~dp0"

echo.
echo   Building acquisition-2026.html from the Redash cache
echo   (refresh the cache first with 9-refresh-ftd-cache.bat if it is old)
echo   and the newest cost .xlsx in Desktop\CPA 2.0.
echo.

where python >nul 2>&1
if %errorlevel%==0 (set PY=python) else (set PY=py -3)

%PY% -m pip install openpyxl --quiet --disable-pip-version-check >nul 2>&1
%PY% "acquisition-report\build_acquisition.py"

echo.
pause
