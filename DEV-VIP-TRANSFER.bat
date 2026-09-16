@echo off
REM Local dev server for the VIP Transfer page -- edit, save, the browser reloads.
REM Uses the data already in vip-transfer\data, so it works off the VPN.
REM Run 13-build-vip-transfer.bat first if you want fresh numbers.
cd /d "%~dp0vip-transfer"
start "" http://localhost:8899
node dev.js
