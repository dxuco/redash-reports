@echo off
setlocal
set AGENT=C:\redash-page\workspace-agent
echo Creating the daily task "Workspace sync" at 07:30...
schtasks /create /f /tn "Workspace sync" /sc daily /st 07:30 /tr "cmd /c cd /d %AGENT% && python workspace_agent.py run >> agent.log 2>&1"
if errorlevel 1 (echo.& echo Could not create the task. Try running this file as administrator.) else (echo.& echo Done. It will run every morning at 07:30 while the PC is on and the VPN is connected.)
echo.
echo To remove it later:  schtasks /delete /tn "Workspace sync" /f
pause
