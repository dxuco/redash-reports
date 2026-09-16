@echo off
title Step 7 - is the public page protected?
cd /d "%~dp0"

echo.
echo   Making real requests to the live address from this machine:
echo   with no password, with a wrong one, and with a correct one.
echo.
echo   A browser can mislead you here because it remembers logins.
echo   This does not.
echo.

node verify-public.js

echo.
pause
