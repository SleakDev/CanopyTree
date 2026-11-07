@echo off
setlocal
title CanopyTree - Tree Studio
cd /d "%~dp0"

rem If the studio is already running, just open it.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { Start-Process 'http://127.0.0.1:5173/'; exit 0 } else { exit 1 }"
if not errorlevel 1 exit /b 0

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :error
)

rem Wait until Vite answers, then open the default browser.
start "" powershell -NoProfile -WindowStyle Hidden -Command "$url='http://127.0.0.1:5173/'; for ($i = 0; $i -lt 60; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 1; if ($r.StatusCode -eq 200) { Start-Process $url; break } } catch {}; Start-Sleep -Milliseconds 500 }"

call npm.cmd run dev

echo.
echo The dev server has stopped.
pause
exit /b 0

:error
echo.
echo Could not start CanopyTree. Make sure Node.js is installed and available on PATH.
pause
exit /b 1
