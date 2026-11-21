@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop.ps1" %*
set "result=%errorlevel%"
if not "%result%"=="0" (
  echo.
  echo Service shutdown failed. See the message above.
  pause
)
exit /b %result%
