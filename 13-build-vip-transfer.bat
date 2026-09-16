@echo off
REM Full refresh of the VIP Transfer page: tracker sheet -> Redash -> HTML.
REM Called by UPDATE-EVERYTHING.bat; also runnable on its own.
cd /d "%~dp0vip-transfer"
node fetch_vip.js            || goto :fail
python build_vip_transfer.py || goto :fail
python make_vip_transfer_html.py || goto :fail
node test_vip_transfer.js
echo.
echo   VIP transfer page rebuilt.
exit /b 0
:fail
echo.
echo   ** VIP transfer refresh failed - vip-transfer.html is untouched.
exit /b 1
