@echo off
cd /d "%~dp0"
echo Running Workspace sync agent...
python workspace_agent.py run
if errorlevel 1 (echo.& echo Something failed - see agent.log) else (echo.& echo Done.)
pause
