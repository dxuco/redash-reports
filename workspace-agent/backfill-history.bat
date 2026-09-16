@echo off
REM Loads the Redash month caches on this PC into the workspace app, one month at a
REM time. No VPN needed - the files are already on disk. Safe to re-run: each month
REM replaces only its own dates. The current month is left alone; the daily sync owns it.
setlocal
cd /d "%~dp0"

set "CACHE=C:\redash-page\ftd-report\cache"
set "COLS=transaction_date,player_id,player_country,aff_type,aff_username,aff_source,ftd_type,reg_date,first_deposit_date,sign_up,ftd,blockchain,deposit,deposit_count,withdraw,game_product,bet,ggr,ngr,adjusted_ggr,bonus_cost,favourite_product,click_count"

echo Backfilling FTD history into the workspace app.
echo This takes a while - roughly a minute or two per month.
echo.

for %%M in (2025-01 2025-02 2025-03 2025-04 2025-05 2025-06 2025-07 2025-08 2025-09 2025-10 2025-11 2025-12 2026-01 2026-02 2026-03 2026-04 2026-05 2026-06 2026-07 2026-08) do (
  if exist "%CACHE%\%%M.json" (
    echo ================ %%M
    python workspace_agent.py push --dataset fj-1732 --mode per-month --range-column transaction_date --columns "%COLS%" "%CACHE%\%%M.json"
    if errorlevel 1 echo *** %%M FAILED - see the message above
  ) else (
    echo skipping %%M - no cache file
  )
)

echo.
echo Done. Open https://app.k-ai.talk/data to see the row count and size.
pause
