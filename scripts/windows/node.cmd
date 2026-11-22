@echo off
rem Runs node.ps1 without changing the system-wide execution policy.
rem Prefers PowerShell 7 (pwsh); falls back to the built-in Windows PowerShell 5.1.
rem Usage: scripts\windows\node.cmd npx tsx scripts/smoke-rpn.ts
set "PS_EXE=powershell.exe"
where pwsh.exe >nul 2>nul && set "PS_EXE=pwsh.exe"
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0node.ps1" %*
exit /b %ERRORLEVEL%
