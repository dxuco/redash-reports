@echo off
title Install the daily schedule
cd /d "%~dp0"

REM Unattended. Writes the outcome to install-schedule.log.
REM
REM Three triggers, because a laptop that sleeps will miss a single daily one:
REM   1. the daily time from config.env
REM   2. when you log on (3 minutes later)
REM   3. when the machine unlocks after being idle
REM All three run  build.js --if-stale , which does nothing if today's build
REM already happened. So whichever fires first wins, and the rest are no-ops.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$log = Join-Path '%~dp0' 'install-schedule.log';" ^
  "function Say($t){ Write-Host $t; Add-Content -Path $log -Value $t }" ^
  "Set-Content -Path $log -Value ('=== ' + (Get-Date) + ' ===');" ^
  "try {" ^
  "  $here = '%~dp0'.TrimEnd('\');" ^
  "  $cfg = @{};" ^
  "  Get-Content (Join-Path $here 'config.env') | ForEach-Object {" ^
  "    if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$matches[1]] = $matches[2].Trim() } };" ^
  "  $h = [int]($cfg['BUILD_HOUR']); $m = [int]($cfg['BUILD_MINUTE']);" ^
  "  $when = (Get-Date -Hour $h -Minute $m -Second 0);" ^
  "  $node = (Get-Command node -ErrorAction Stop).Source;" ^
  "  $action = New-ScheduledTaskAction -Execute $node -Argument 'build.js --if-stale' -WorkingDirectory $here;" ^
  "  $daily = New-ScheduledTaskTrigger -Daily -At $when;" ^
  "  $logon = New-ScheduledTaskTrigger -AtLogOn;" ^
  "  $logon.Delay = 'PT3M';" ^
  "  $settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew;" ^
  "  if (Get-ScheduledTask -TaskName 'Bonus cost report' -ErrorAction SilentlyContinue) {" ^
  "    Say '  removing the old task first (Windows will not overwrite it in place)';" ^
  "    Unregister-ScheduledTask -TaskName 'Bonus cost report' -Confirm:$false;" ^
  "  }" ^
  "  Register-ScheduledTask -TaskName 'Bonus cost report' -Action $action -Trigger @($daily,$logon) -Settings $settings -Description 'Rebuilds the bonus cost report from Redash and publishes it. Runs at the daily time, or at logon if that was missed.' | Out-Null;" ^
  "  $i = Get-ScheduledTaskInfo -TaskName 'Bonus cost report';" ^
  "  $t = Get-ScheduledTask -TaskName 'Bonus cost report';" ^
  "  Say 'RESULT: installed';" ^
  "  Say ('  daily at  : ' + $when.ToString('HH:mm') + ' local time');" ^
  "  Say ('  plus      : 3 minutes after each logon, if that day is not built yet');" ^
  "  Say ('  triggers  : ' + $t.Triggers.Count);" ^
  "  Say ('  state     : ' + $t.State);" ^
  "  Say ('  next run  : ' + $i.NextRunTime);" ^
  "  Say ('  runs      : ' + $node + ' build.js --if-stale');" ^
  "} catch {" ^
  "  Say ('RESULT: failed - ' + $_.Exception.Message);" ^
  "}"
