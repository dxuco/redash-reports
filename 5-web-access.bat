@echo off
title Web access
cd /d "%~dp0"

REM --- 1. get cloudflared if we don't have it -------------------------------
if not exist cloudflared.exe (
  echo.
  echo   Downloading cloudflared from Cloudflare's official release page.
  echo   About 25 MB, one time only.
  echo.
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' -UseBasicParsing } catch { Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 (
    echo   Download failed. Check your connection and try again.
    pause
    exit /b 1
  )
)

REM --- 2. is anything already on port 8080? --------------------------------
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 8080); $c.Close(); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo   Starting the report server...
  start "Report server" cmd /c "node server.js"
  timeout /t 5 >nul
)

REM --- 3. SAFETY GATE ------------------------------------------------------
REM Never open a tunnel unless the thing answering on 8080 demands a login.
REM An unauthenticated server here would publish player data to the internet.
echo.
echo   Checking that the page is password protected...

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/' -UseBasicParsing -TimeoutSec 10; Write-Host ('   Server answered ' + [int]$r.StatusCode + ' with NO login required.'); exit 1 } catch { $s = [int]$_.Exception.Response.StatusCode; if ($s -eq 401) { Write-Host '   Good - the server requires a login (401).'; exit 0 } else { Write-Host ('   Unexpected response: ' + $s); exit 1 } }"

if errorlevel 1 (
  echo.
  echo   ============================================================
  echo     STOPPING. Not opening a tunnel.
  echo.
  echo     Whatever is answering on port 8080 does not ask for a
  echo     password. That is very likely an older server window
  echo     still running from earlier.
  echo.
  echo     Close every black window titled "Redash page" or
  echo     "Report server", then run this file again.
  echo   ============================================================
  echo.
  pause
  exit /b 1
)

REM --- 4. open it to the web -----------------------------------------------
echo.
echo   ============================================================
echo     Your public address appears below.
echo     Look for the line ending in  trycloudflare.com
echo.
echo     Anyone opening it must log in:
echo        user      veis
echo        password  see AUTH_PASSWORD in config.env
echo.
echo     Keep this window open. Closing it takes the site offline.
echo   ============================================================
echo.

cloudflared.exe tunnel --url http://localhost:8080

echo.
echo   Tunnel stopped - the public address no longer works.
pause
