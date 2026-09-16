@echo off
title Install the daily full-site update
cd /d "%~dp0"

REM ===========================================================================
REM  Registers a Windows scheduled task that runs UPDATE-EVERYTHING.bat /auto
REM  once a day, so the site is already current before you sit down.
REM
REM  The old "Bonus cost report" task only rebuilt the bonus cost page. This
REM  replaces it with one that rebuilds all four.
REM
REM  RIGHT-CLICK THIS FILE AND CHOOSE "RUN AS ADMINISTRATOR".
REM  The last attempt at installing a task failed with "Access is denied",
REM  which is what that looks like when it is run without elevation.
REM
REM  Triggers: the daily time from config.env (BUILD_HOUR / BUILD_MINUTE),
REM  plus 5 minutes after each logon, so a machine that was asleep still
REM  catches up. Only one instance can run at a time.
REM ===========================================================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   This needs to run as administrator.
  echo   Close this window, right-click INSTALL-DAILY-UPDATE.bat,
  echo   and choose "Run as administrator".
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$log = Join-Path '%~dp0' 'install-daily-update.log';" ^
  "function Say($t){ Write-Host $t; Add-Content -Path $log -Value $t }" ^
  "Set-Content -Path $log -Value ('=== ' + (Get-Date) + ' ===');" ^
  "try {" ^
  "  $here = '%~dp0'.TrimEnd('\');" ^
  "  $cfg = @{};" ^
  "  Get-Content (Join-Path $here 'config.env') | ForEach-Object {" ^
  "    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$matches[1]] = $matches[2].Trim() } };" ^
  "  $h = [int]($cfg['BUILD_HOUR']); $m = [int]($cfg['BUILD_MINUTE']);" ^
  "  $when = (Get-Date -Hour $h -Minute $m -Second 0);" ^
  "  $bat = Join-Path $here 'UPDATE-EVERYTHING.bat';" ^
  "  if (-not (Test-Path $bat)) { throw 'UPDATE-EVERYTHING.bat is not next to this installer.' };" ^
  "  $arg = '/c \"\"' + $bat + '\" /auto >> \"' + (Join-Path $here 'update-all.log') + '\" 2>&1\"';" ^
  "  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $arg -WorkingDirectory $here;" ^
  "  $daily = New-ScheduledTaskTrigger -Daily -At $when;" ^
  "  $logon = New-ScheduledTaskTrigger -AtLogOn;" ^
  "  $logon.Delay = 'PT5M';" ^
  "  $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew;" ^
  "  foreach ($old in @('Bonus cost report','Veis reports - full update')) {" ^
  "    if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) {" ^
  "      Say ('  removing old task: ' + $old);" ^
  "      Unregister-ScheduledTask -TaskName $old -Confirm:$false } };" ^
  "  Register-ScheduledTask -TaskName 'Veis reports - full update' -Action $action -Trigger @($daily,$logon) -Settings $settings -RunLevel Highest -Description 'Rebuilds Bonus Cost, FTD Report, Acquisition and Cost 2025 from Redash and Drive, then publishes the Cloudflare Worker site.' | Out-Null;" ^
  "  $i = Get-ScheduledTaskInfo -TaskName 'Veis reports - full update';" ^
  "  Say 'RESULT: installed';" ^
  "  Say ('  daily at : ' + $when.ToString('HH:mm') + ' local time');" ^
  "  Say ('  plus     : 5 minutes after each logon');" ^
  "  Say ('  next run : ' + $i.NextRunTime);" ^
  "  Say ('  log      : ' + (Join-Path $here 'update-all.log'));" ^
  "} catch {" ^
  "  Say ('RESULT: failed - ' + $_.Exception.Message);" ^
  "}"

echo.
echo   To run it right now without waiting:  double-click UPDATE-EVERYTHING.bat
echo   To remove it:  Task Scheduler, delete "Veis reports - full update"
echo.
pause
