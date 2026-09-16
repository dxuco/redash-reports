@echo off
title Check the daily schedule
cd /d "%~dp0"

REM Runs unattended and writes to check-schedule.log so the result can be
REM read afterwards without anyone pressing a key.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$log = Join-Path '%~dp0' 'check-schedule.log';" ^
  "function Say($t){ Write-Host $t; Add-Content -Path $log -Value $t }" ^
  "Set-Content -Path $log -Value ('=== checked ' + (Get-Date) + ' ===');" ^
  "$name='Bonus cost report';" ^
  "$t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue;" ^
  "if (-not $t) { Say 'TASK: not installed - run install-schedule.bat'; exit }" ^
  "$i = Get-ScheduledTaskInfo -TaskName $name;" ^
  "Say ('TASK state      : ' + $t.State);" ^
  "Say ('last run        : ' + $i.LastRunTime);" ^
  "Say ('next run        : ' + $i.NextRunTime);" ^
  "$r = $i.LastTaskResult;" ^
  "$meaning = switch ($r) { 0 {'success'} 267011 {'has not run yet'} 267009 {'currently running'} 267014 {'was stopped'} default {'FAILED (code ' + $r + ')'} };" ^
  "Say ('last result     : ' + $meaning + ' [' + $r + ']');" ^
  "$running = (Get-ScheduledTask -TaskName $name).State -eq 'Running';" ^
  "Say ('running now     : ' + $running);" ^
  "if (Test-Path 'data.json') {" ^
  "  $d = Get-Item 'data.json';" ^
  "  $age = [math]::Round((New-TimeSpan -Start $d.LastWriteTime -End (Get-Date)).TotalHours,1);" ^
  "  Say ('data.json       : ' + $d.LastWriteTime + '  (' + $age + ' hours old)');" ^
  "} else { Say 'data.json       : missing' }" ^
  "if (Test-Path 'publish\index.html') { Say ('published copy  : ' + (Get-Item 'publish\index.html').LastWriteTime) }" ^
  "$node = Get-Process node -ErrorAction SilentlyContinue;" ^
  "Say ('node processes  : ' + $(if ($node) { $node.Count } else { 0 }));"
