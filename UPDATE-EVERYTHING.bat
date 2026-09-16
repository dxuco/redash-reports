@echo off
setlocal
title ONE CLICK - refresh every report and publish the site
cd /d "%~dp0"

REM ===========================================================================
REM  UPDATE-EVERYTHING.bat
REM
REM  Double-click to rebuild every report and publish the site.
REM
REM  This file used to run thirteen steps strictly one after another and took
REM  about ten minutes. Most of those steps only read the month caches and
REM  never touch each other's output, so most of that time was spent waiting
REM  for nothing. The work now lives in pipeline.py, which runs the steps in
REM  parallel wherever the dependencies allow:
REM
REM    - the three Redash pulls (bonus cost, acquisition, VIP transfer) run
REM      alongside the cache refresh instead of queueing behind it
REM    - the six builders that read the shared cache run together once it lands
REM    - publish waits for all of them, then verify waits for publish
REM
REM  Everything the old file guaranteed still holds:
REM    - a step that fails never stops the others; whatever could not rebuild
REM      is published as its previous copy and named in the summary
REM    - the run is recorded in update-all.log whether or not anyone is watching
REM    - publish output is captured to publish-last.log
REM
REM  Per-step output goes to logs\<name>.log rather than the console, because
REM  six steps printing at once interleaves into something unreadable and the
REM  one line explaining a failure is exactly what gets lost.
REM
REM  Task Scheduler runs this with /auto, which skips the pause at the end.
REM ===========================================================================

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js is not installed or not on PATH. Install the LTS from
  echo   https://nodejs.org and run this again.
  echo.
  if not "%~1"=="/auto" pause
  exit /b 1
)

where python >nul 2>&1
if %errorlevel%==0 (set "PY=python") else (set "PY=py -3")

REM  openpyxl is needed by the acquisition step and is cheap to assert.
%PY% -m pip install openpyxl --quiet --disable-pip-version-check >nul 2>&1

%PY% "%~dp0pipeline.py"
set "RC=%errorlevel%"

if not "%~1"=="/auto" pause
exit /b %RC%
